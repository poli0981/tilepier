import type { RequestHandler } from './$types';
import { cacheKey } from '$lib/shared-constants';
import { readCache, ttlSeconds, writeCache, type CachedValue } from '../../_lib/kv-cache';
import { breakerVerdict, readBreaker, recordFailure, recordSuccess } from '../../_lib/breaker';
import { checkRateLimit } from '../../_lib/ratelimit';
import { parseCryptoTickerQuery } from '../../_lib/crypto-query';
import { fetchUpstream, UpstreamError } from '../../_lib/upstream';
import { fail, isCrossSite, ok } from '../../_lib/respond';
import { normalizeCryptoTicker } from '../../_lib/normalize';
import { tickerBatchUrl, tickerSymbolUrl } from '../../_lib/binance';
import type { TpCryptoTickerPayload } from '$lib/api-types';

/**
 * `GET /api/crypto/ticker?symbols=BTCUSDT,ETHUSDT` — doc 11 §3, upstream doc
 * 10 §4.
 *
 * The reference pipeline with one addition, and the addition is the whole
 * interesting part of this file — see `fetchSymbols` below.
 *
 * Keyless, like Open-Meteo and ER-API, so every branch here is reachable in
 * tests and in a fork. The first `/api/*` route that needs a key is
 * `/api/stock/quote` in Week 5b.
 */

/** The breaker key, and the `source` every response carries. */
const UPSTREAM = 'binance';

/** doc 11 §4's family for this payload. */
const FAMILY = 'crTick';

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const query = parseCryptoTickerQuery(url);
	if (!query) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	// The canonical set, not the requested order: two readers whose watchlists
	// differ only in arrangement must share one entry (doc 04 §5).
	const key = cacheKey.cryptoTicker(query.canonical.join(','));
	const cached = await readCache<TpCryptoTickerPayload>(kv, FAMILY, key);

	if (cached.status === 'HIT' && cached.value) return serve(cached.value, 'HIT', false);

	const breaker = await readBreaker(kv, UPSTREAM);
	if (breakerVerdict(breaker, Date.now()) === 'open') return serveStaleOr(cached);

	try {
		const now = Date.now();
		const rows = await fetchSymbols(query.canonical);
		const payload = normalizeCryptoTicker(rows, query.requested, now);

		/*
		 * An answer with no rows in it is not an answer — the same guard
		 * `/api/fx` keeps against ER-API replying 200 with no `rates`. Without
		 * it a shape change upstream would be cached for its whole window and
		 * every row would render as unavailable with no error anywhere.
		 *
		 * `some` rather than `every`: a watchlist where one coin was delisted
		 * *should* cache with that row null, which is the case the split fetch
		 * below exists to produce.
		 */
		if (!Object.values(payload.quotes).some((quote) => quote !== null)) {
			throw new UpstreamError('binance answered for none of the symbols', 'malformed');
		}

		// doc 11 §8: persistence rides on waitUntil so the response does not wait
		// on it, and so a throttled KV write cannot turn a good fetch into a 500.
		const persist = Promise.all([
			writeCache(kv, FAMILY, key, payload, UPSTREAM, now),
			recordSuccess(kv, UPSTREAM)
		]).catch(() => undefined);
		if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(persist);
		else void persist;

		return ok(
			payload,
			{ cachedAt: Math.floor(now / 1000), source: UPSTREAM, stale: false },
			'MISS',
			ttlSeconds(FAMILY)
		);
	} catch (error) {
		const upstream = error instanceof UpstreamError ? error : null;

		// doc 10 §4: 429 carries `Retry-After` and 418 is an IP ban; both are
		// upstream telling us to stop rather than a flaky request, so the breaker
		// opens on the first one instead of on the third.
		const immediate = upstream?.status === 429 || upstream?.status === 418;
		await recordFailure(kv, UPSTREAM, upstream?.message ?? String(error), { immediate }).catch(
			() => undefined
		);

		if (upstream?.status && upstream.status >= 400 && upstream.status < 500 && !immediate) {
			return fail('BAD_REQUEST');
		}
		return serveStaleOr(cached);
	}
};

/**
 * One batched call, falling back to one call per symbol **only** when the batch
 * was refused for naming a symbol Binance does not have.
 *
 * This is the part doc 09 §1 needs and the part the spec does not say out loud:
 * `/ticker/24hr?symbols=[...]` is all-or-nothing. A single delisted or mistyped
 * coin makes the whole request a 400, so a watchlist that worked yesterday
 * takes the entire tile down the morning a coin is removed — every other row
 * with it. That section's "delisted symbol → row error chip with a remove
 * shortcut" is unreachable without splitting.
 *
 * Bounded and cheap: at most twelve keyless requests, on the error path only,
 * and the assembled result caches under the same set key as a normal answer —
 * so the split happens once per TTL rather than once per reader.
 * `allSettled` because the whole point is that some of them fail.
 *
 * **Only on 400.** A 429, a 418 or a 5xx means upstream is refusing us or is
 * down, and answering that by multiplying one request into twelve is the exact
 * shape doc 11 §6's breaker exists to prevent.
 */
async function fetchSymbols(symbols: readonly string[]): Promise<unknown> {
	try {
		const batch = await fetchUpstream<unknown>(tickerBatchUrl(symbols));
		return batch.data;
	} catch (error) {
		const status = error instanceof UpstreamError ? error.status : undefined;
		// A one-symbol batch that 400s has nothing to split into: the single
		// symbol is the bad one, and asking again the other way would spend a
		// second request to learn what this one already said.
		if (status !== 400 || symbols.length < 2) throw error;
		return splitFetch(symbols);
	}
}

async function splitFetch(symbols: readonly string[]): Promise<unknown[]> {
	const settled = await Promise.allSettled(
		symbols.map((symbol) => fetchUpstream<unknown>(tickerSymbolUrl(symbol)))
	);

	const rows: unknown[] = [];
	for (const result of settled) if (result.status === 'fulfilled') rows.push(result.value.data);
	return rows;
}

function serve(
	value: CachedValue<TpCryptoTickerPayload>,
	status: 'HIT' | 'STALE',
	stale: boolean
): Response {
	return ok(
		value.payload,
		{ cachedAt: Math.floor(value.cachedAt / 1000), source: value.source, stale },
		status,
		ttlSeconds(FAMILY)
	);
}

/**
 * doc 11 §4: between the TTL and the stale window a cached value is served
 * **only** when upstream fails, flagged `stale: true` so the tile shows the
 * amber badge rather than presenting a ten-minute-old price as the market.
 */
function serveStaleOr(
	cached: Awaited<ReturnType<typeof readCache<TpCryptoTickerPayload>>>
): Response {
	if (cached.value) return serve(cached.value, 'STALE', true);
	return fail('UPSTREAM_DOWN');
}
