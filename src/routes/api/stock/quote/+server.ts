import type { RequestHandler } from './$types';
import type { TpStockQuote, TpStockQuotePayload } from '$lib/api-types';
import { cacheKey } from '$lib/shared-constants';
import { breakerVerdict, readBreaker, recordFailure, recordSuccess } from '../../_lib/breaker';
import { FINNHUB, FINNHUB_ATTRIBUTION, finnhubHeaders, finnhubQuoteUrl } from '../../_lib/finnhub';
import { readCache, ttlSeconds, writeCache, type CachedValue } from '../../_lib/kv-cache';
import { normalizeStockQuote } from '../../_lib/normalize';
import { checkRateLimit } from '../../_lib/ratelimit';
import { fail, isCrossSite, ok } from '../../_lib/respond';
import { parseStockQuoteQuery } from '../../_lib/stock-query';
import { fetchUpstream, UpstreamError } from '../../_lib/upstream';

/**
 * `GET /api/stock/quote?symbols=AAPL,MSFT` — doc 11 §3, upstream doc 10 §5.
 *
 * **Cached per symbol, fetched per symbol.** Finnhub's `/quote` takes one symbol,
 * and doc 11 §3 asks for each to be cached on its own under `st:q:v1:<sym>`, so
 * two watchlists sharing AAPL share its quote. The response is still one
 * payload for the whole set, and only the symbols that missed go upstream —
 * at most twelve, and on a warm cache usually none.
 *
 * **An unknown symbol is an answer, not a failure.** Finnhub replies 200 with
 * every field zero; that normalises to `null` and is cached like any quote, so
 * a mistyped symbol costs one call per TTL rather than one per request, and
 * never counts against the breaker. `/api/stock/series` reads the same entry
 * to decide whether a symbol may spend a Twelve Data credit (doc 11 §5).
 */

const FAMILY = 'stQuote';

type Row = CachedValue<TpStockQuote | null>;

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const query = parseStockQuoteQuery(url);
	if (!query) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const now = Date.now();
	const fresh = new Map<string, Row>();
	const stale = new Map<string, Row>();
	const missing: string[] = [];

	await Promise.all(
		query.canonical.map(async (symbol) => {
			const read = await readCache<TpStockQuote | null>(
				kv,
				FAMILY,
				cacheKey.stockQuote(symbol),
				now
			);
			if (read.status === 'HIT' && read.value) fresh.set(symbol, read.value);
			else {
				if (read.value) stale.set(symbol, read.value);
				missing.push(symbol);
			}
		})
	);

	const fetched = new Map<string, Row>();
	let upstreamDown = false;

	if (missing.length > 0) {
		const key = platform?.env.FINNHUB_KEY ?? '';
		const breaker = await readBreaker(kv, FINNHUB);
		if (key === '' || breakerVerdict(breaker, now) === 'open') {
			upstreamDown = true;
		} else {
			const outcome = await fetchQuotes(missing, key, now);
			upstreamDown = outcome.failure !== null;
			for (const [symbol, quote] of outcome.quotes) {
				fetched.set(symbol, { cachedAt: now, source: FINNHUB, payload: quote });
			}

			// doc 11 §8: persistence rides on waitUntil. Only answers are cached —
			// a symbol whose call failed keeps whatever stale entry it had.
			const persist = Promise.all([
				...[...outcome.quotes].map(([symbol, quote]) =>
					writeCache(kv, FAMILY, cacheKey.stockQuote(symbol), quote, FINNHUB, now)
				),
				outcome.failure === null
					? recordSuccess(kv, FINNHUB)
					: recordFailure(kv, FINNHUB, outcome.failure.message, {
							immediate: outcome.failure.status === 429
						})
			]).catch(() => undefined);
			if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(persist);
			else void persist;
		}
	}

	const quotes: Record<string, TpStockQuote | null> = {};
	let servedStale = false;
	let answered = false;
	let oldest = now;

	for (const symbol of query.requested) {
		const row = fresh.get(symbol) ?? fetched.get(symbol) ?? stale.get(symbol);
		if (row === undefined) {
			quotes[symbol] = null;
			continue;
		}
		answered = true;
		if (!fresh.has(symbol) && !fetched.has(symbol)) servedStale = true;
		oldest = Math.min(oldest, row.cachedAt);
		quotes[symbol] = row.payload;
	}

	// Nothing to show and upstream unreachable: the tile's error state, not a
	// column of "no quote" rows that would read as twelve delistings.
	if (!answered && upstreamDown) return fail('UPSTREAM_DOWN');

	const payload: TpStockQuotePayload = { quotes, attribution: FINNHUB_ATTRIBUTION };
	const status = servedStale ? 'STALE' : fetched.size > 0 ? 'MISS' : 'HIT';
	return ok(
		payload,
		{ cachedAt: Math.floor(oldest / 1000), source: FINNHUB, stale: servedStale },
		status,
		ttlSeconds(FAMILY)
	);
};

interface Outcome {
	quotes: Map<string, TpStockQuote | null>;
	failure: UpstreamError | null;
}

/**
 * One Finnhub call per missing symbol, settled together. A symbol that answered
 * is kept even when a neighbour failed; the first failure is what the breaker
 * hears, and a 429 opens it at once (doc 11 §6).
 */
async function fetchQuotes(symbols: readonly string[], key: string, now: number): Promise<Outcome> {
	const settled = await Promise.allSettled(
		symbols.map((symbol) =>
			fetchUpstream<unknown>(finnhubQuoteUrl(symbol), { headers: finnhubHeaders(key) })
		)
	);

	const quotes = new Map<string, TpStockQuote | null>();
	let failure: UpstreamError | null = null;

	settled.forEach((result, index) => {
		const symbol = symbols[index];
		if (symbol === undefined) return;
		if (result.status === 'fulfilled') {
			quotes.set(symbol, normalizeStockQuote(result.value.data, symbol, now));
		} else {
			failure ??=
				result.reason instanceof UpstreamError
					? result.reason
					: new UpstreamError(String(result.reason), 'network');
		}
	});

	return { quotes, failure };
}
