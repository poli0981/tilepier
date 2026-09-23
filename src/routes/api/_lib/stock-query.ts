import { STOCK_INTERVALS, STOCK_RANGES, type TpStockInterval } from '$lib/api-types';
import { isMarketSymbol, stockSearchText } from '$lib/shared-constants';
import { parseCryptoTickerQuery, type TpCryptoTickerQuery } from './crypto-query';

/**
 * Query validation for `/api/stock/*` (doc 11 §3, doc 10 §5). In `_lib` for
 * the reason `crypto-query.ts` gives: SvelteKit refuses non-handler exports
 * from a `+server.ts`, and only at build time.
 */

/**
 * `?symbols=AAPL,MSFT` — the same contract as the crypto ticker's, down to the
 * refusals: over twelve is refused rather than truncated, and a symbol outside
 * doc 10 §5's allowlist is refused rather than dropped. One parser for both, so
 * the two lists cannot come to disagree about what a symbol is.
 */
export function parseStockQuoteQuery(url: URL): TpCryptoTickerQuery | null {
	return parseCryptoTickerQuery(url);
}

/** Every depth a stock range picker can ask for — the allowlist `limit` is. */
const LIMITS = new Set<number>(Object.values(STOCK_RANGES).map((range) => range.limit));

export interface TpStockSeriesQuery {
	symbol: string;
	interval: TpStockInterval;
	/** How many bars to answer with — never how many to fetch. */
	limit: number;
}

/**
 * `?symbol=AAPL&interval=1day&limit=22`. `limit` is an allowlist derived from
 * `STOCK_RANGES`, for the klines route's reason: the response is cacheable by
 * URL, and a free integer would be 260 edge entries per symbol.
 */
export function parseStockSeriesQuery(url: URL): TpStockSeriesQuery | null {
	const symbol = url.searchParams.get('symbol')?.trim().toUpperCase() ?? '';
	if (!isMarketSymbol(symbol)) return null;

	const interval = url.searchParams.get('interval');
	if (interval === null || !(STOCK_INTERVALS as readonly string[]).includes(interval)) return null;

	const limit = Number(url.searchParams.get('limit'));
	if (!LIMITS.has(limit)) return null;

	return { symbol, interval: interval as TpStockInterval, limit };
}

export interface TpStockSearchQuery {
	/** Sent upstream as typed, minus surrounding space. */
	text: string;
	/** Lower-cased and space-collapsed: the `<q-norm>` of the cache key. */
	norm: string;
}

/**
 * `?q=apple`. The rule itself is `stockSearchText`, shared with the detail's
 * search box so the client never offers a search this refuses.
 */
export function parseStockSearchQuery(url: URL): TpStockSearchQuery | null {
	const text = stockSearchText(url.searchParams.get('q') ?? '');
	return text === null ? null : { text, norm: text.toLowerCase() };
}
