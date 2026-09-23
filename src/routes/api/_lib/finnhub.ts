/**
 * Finnhub (doc 10 §5): stock quotes and symbol search. The free tier answers
 * 403 on `/stock/candle`, which is why series come from Twelve Data instead
 * (CLAUDE.md rule 5).
 *
 * **The key rides in a header, never in the URL.** A URL is what an
 * `UpstreamError` message carries into the breaker's `reason`, and the reason
 * is what `/api/_health` prints. Finnhub accepts `X-Finnhub-Token` for exactly
 * this.
 */

const HOST = 'https://finnhub.io/api/v1';

/** The breaker key, and the `source` every Finnhub-backed response carries. */
export const FINNHUB = 'finnhub';

export const FINNHUB_ATTRIBUTION = 'Stock quotes by Finnhub';

export function finnhubHeaders(key: string): Record<string, string> {
	return { 'x-finnhub-token': key };
}

export function finnhubQuoteUrl(symbol: string): string {
	return `${HOST}/quote?${new URLSearchParams({ symbol }).toString()}`;
}

/** `exchange=US`: the watchlist is US equities (doc 09 §1), and without it a
 *  search for "apple" is mostly Frankfurt and Mexico City listings. */
export function finnhubSearchUrl(query: string): string {
	return `${HOST}/search?${new URLSearchParams({ q: query, exchange: 'US' }).toString()}`;
}
