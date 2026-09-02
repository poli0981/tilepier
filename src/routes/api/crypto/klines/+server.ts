import type { RequestHandler } from './$types';
import { cacheKey, cryptoKlinesFamily, type TpCacheFamily } from '$lib/shared-constants';
import { readCache, ttlSeconds, writeCache, type CachedValue } from '../../_lib/kv-cache';
import { breakerVerdict, readBreaker, recordFailure, recordSuccess } from '../../_lib/breaker';
import { checkRateLimit } from '../../_lib/ratelimit';
import { parseCryptoKlinesQuery } from '../../_lib/crypto-query';
import { fetchUpstream, UpstreamError } from '../../_lib/upstream';
import { fail, isCrossSite, ok } from '../../_lib/respond';
import { normalizeCryptoKlines } from '../../_lib/normalize';
import type { TpCryptoInterval, TpCryptoKlinesPayload } from '$lib/api-types';

/**
 * `GET /api/crypto/klines?symbol=BTCUSDT&interval=5m&limit=288` — doc 11 §3,
 * upstream doc 10 §4.
 *
 * **One deep series is cached; the response is a window onto it.** doc 11 §4
 * keys this payload `cr:kl:v1:<sym>:<int>` — no depth in the key at all — so
 * two ranges over the same symbol and interval would otherwise overwrite each
 * other, and a reader who looked at 1W and then 1M would get 1W's data under
 * 1M's label. Silently: the shapes are identical.
 *
 * So the fetch is always `FETCH_LIMIT` candles and the slice happens here.
 * `FETCH_LIMIT` covers every range at every interval — 500 × 5 min is 41 hours
 * against 1D's 24, 500 hours is 20 days against 1W's 7, 500 days is sixteen
 * months against 1Y's twelve — and the deep series costs one upstream call
 * rather than one per range. That is the same answer `/api/stock/series` needs
 * in Week 5b for the same reason, arriving one endpoint early.
 */

/** doc 10 §4's config constant, not an inline host. */
const HOSTS = ['https://api.binance.com'] as const;
const HOST = HOSTS[0];

const UPSTREAM = 'binance';

/**
 * Binance's own ceiling for this endpoint, and the depth every range fits
 * inside. Fetching less would make the cache entry range-dependent, which is
 * the thing the key cannot express.
 */
const FETCH_LIMIT = 500;

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const query = parseCryptoKlinesQuery(url);
	if (!query) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const family = cryptoKlinesFamily(query.interval);
	const key = cacheKey.cryptoKlines(query.symbol, query.interval);
	const cached = await readCache<TpCryptoKlinesPayload>(kv, family, key);

	if (cached.status === 'HIT' && cached.value) {
		return serve(cached.value, 'HIT', false, family, query.limit);
	}

	const breaker = await readBreaker(kv, UPSTREAM);
	if (breakerVerdict(breaker, Date.now()) === 'open') {
		return serveStaleOr(cached, family, query.limit);
	}

	try {
		const now = Date.now();
		const body = await fetchUpstream<unknown>(seriesUrl(query.symbol, query.interval));
		const payload = normalizeCryptoKlines(body.data, query.symbol, query.interval);

		// An empty series is not an answer. Binance replies 200 with `[]` for a
		// symbol it knows nothing about, and caching that would draw an empty
		// chart for the whole window with no error anywhere to explain it.
		if (payload.candles.length === 0) {
			throw new UpstreamError('binance returned no candles', 'malformed');
		}

		// doc 11 §8: persistence rides on waitUntil so the response does not wait
		// on it. The **deep** payload is what is stored.
		const persist = Promise.all([
			writeCache(kv, family, key, payload, UPSTREAM, now),
			recordSuccess(kv, UPSTREAM)
		]).catch(() => undefined);
		if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(persist);
		else void persist;

		return ok(
			window(payload, query.limit),
			{ cachedAt: Math.floor(now / 1000), source: UPSTREAM, stale: false },
			'MISS',
			ttlSeconds(family)
		);
	} catch (error) {
		const upstream = error instanceof UpstreamError ? error : null;

		const immediate = upstream?.status === 429 || upstream?.status === 418;
		await recordFailure(kv, UPSTREAM, upstream?.message ?? String(error), { immediate }).catch(
			() => undefined
		);

		if (upstream?.status && upstream.status >= 400 && upstream.status < 500 && !immediate) {
			return fail('BAD_REQUEST');
		}
		return serveStaleOr(cached, family, query.limit);
	}
};

function seriesUrl(symbol: string, interval: TpCryptoInterval): string {
	const params = new URLSearchParams({
		symbol,
		interval,
		limit: String(FETCH_LIMIT)
	});
	return `${HOST}/api/v3/klines?${params.toString()}`;
}

/** The last `limit` candles — the newest ones, which is what a range means. */
function window(payload: TpCryptoKlinesPayload, limit: number): TpCryptoKlinesPayload {
	if (payload.candles.length <= limit) return payload;
	return { ...payload, candles: payload.candles.slice(-limit) };
}

function serve(
	value: CachedValue<TpCryptoKlinesPayload>,
	status: 'HIT' | 'STALE',
	stale: boolean,
	family: TpCacheFamily,
	limit: number
): Response {
	return ok(
		window(value.payload, limit),
		{ cachedAt: Math.floor(value.cachedAt / 1000), source: value.source, stale },
		status,
		ttlSeconds(family)
	);
}

function serveStaleOr(
	cached: Awaited<ReturnType<typeof readCache<TpCryptoKlinesPayload>>>,
	family: TpCacheFamily,
	limit: number
): Response {
	if (cached.value) return serve(cached.value, 'STALE', true, family, limit);
	return fail('UPSTREAM_DOWN');
}
