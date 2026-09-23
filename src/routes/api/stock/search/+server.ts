import type { RequestHandler } from './$types';
import type { TpStockSearchPayload } from '$lib/api-types';
import { cacheKey } from '$lib/shared-constants';
import { breakerVerdict, readBreaker, recordFailure, recordSuccess } from '../../_lib/breaker';
import { FINNHUB, finnhubHeaders, finnhubSearchUrl } from '../../_lib/finnhub';
import { readCache, ttlSeconds, writeCache, type CachedValue } from '../../_lib/kv-cache';
import { normalizeStockSearch } from '../../_lib/normalize';
import { checkRateLimit } from '../../_lib/ratelimit';
import { fail, isCrossSite, ok } from '../../_lib/respond';
import { parseStockSearchQuery } from '../../_lib/stock-query';
import { fetchUpstream, UpstreamError } from '../../_lib/upstream';

/**
 * `GET /api/stock/search?q=apple` — doc 11 §3, upstream doc 10 §5: the
 * manager's search-add, which doc 23 priced and kept. Cached a day under
 * `st:sr:v1:<q-norm>` like geocoding, because a company's ticker rarely moves
 * and every lookup is a Finnhub call.
 */

const FAMILY = 'stSearch';

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const query = parseStockSearchQuery(url);
	if (!query) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const key = cacheKey.stockSearch(query.norm);
	const cached = await readCache<TpStockSearchPayload>(kv, FAMILY, key);
	if (cached.status === 'HIT' && cached.value) return serve(cached.value, 'HIT', false);

	const finnhubKey = platform?.env.FINNHUB_KEY ?? '';
	const now = Date.now();
	if (finnhubKey === '' || breakerVerdict(await readBreaker(kv, FINNHUB), now) === 'open') {
		return serveStaleOr(cached.value);
	}

	try {
		const result = await fetchUpstream<unknown>(finnhubSearchUrl(query.text), {
			headers: finnhubHeaders(finnhubKey)
		});
		const payload = normalizeStockSearch(result.data, query.text);
		const persist = Promise.all([
			writeCache(kv, FAMILY, key, payload, FINNHUB, now),
			recordSuccess(kv, FINNHUB)
		]).catch(() => undefined);
		if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(persist);
		else void persist;

		return ok(
			payload,
			{ cachedAt: Math.floor(now / 1000), source: FINNHUB, stale: false },
			'MISS',
			ttlSeconds(FAMILY)
		);
	} catch (error) {
		const upstream = error instanceof UpstreamError ? error : null;
		await recordFailure(kv, FINNHUB, upstream?.message ?? String(error), {
			immediate: upstream?.status === 429
		}).catch(() => undefined);
		return serveStaleOr(cached.value);
	}
};

function serve(
	value: CachedValue<TpStockSearchPayload>,
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

function serveStaleOr(value: CachedValue<TpStockSearchPayload> | null): Response {
	return value ? serve(value, 'STALE', true) : fail('UPSTREAM_DOWN');
}
