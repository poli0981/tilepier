import type { TpApiResponse, TpStockQuotePayload } from '$lib/api-types';

/**
 * A normalised `/api/stock/quote` envelope (doc 19 §1), the stock twin of
 * `crypto.ts` — the raw Finnhub rows live beside `normalizeStockQuote`'s own
 * tests, which is where the parsing is asserted.
 *
 * Stamped at Monday 2026-08-31's close, 16:00 EDT, which is four hours before
 * the instant the component suites hold the clock at. So every row here is
 * "at the close" to the tile, which is the edge case doc 09 §1 names and the
 * only one that needs a clock to reach.
 *
 * - **`AAPL`** — up on the day, above a dollar: two decimals, the up colour.
 * - **`MSFT`** — down on the day, for the other sign.
 * - **`GONE`** — `null`, the per-row absence Finnhub's all-zeros answer for an
 *   unknown symbol is normalised to, and what the row's remove shortcut is for.
 */

const CLOSE = Date.UTC(2026, 7, 31, 20, 0);

const STOCK_PAYLOAD: TpStockQuotePayload = {
	quotes: {
		AAPL: {
			symbol: 'AAPL',
			price: 227.52,
			changeDay: 0.0041,
			high: 228.4,
			low: 225.1,
			open: 226,
			prevClose: 226.59,
			at: CLOSE
		},
		MSFT: {
			symbol: 'MSFT',
			price: 501.07,
			changeDay: -0.0123,
			high: 509.9,
			low: 499.3,
			open: 507.5,
			prevClose: 507.31,
			at: CLOSE
		},
		GONE: null
	},
	attribution: 'Stock quotes by Finnhub'
};

export const STOCK_OK: TpApiResponse<TpStockQuotePayload> = {
	ok: true,
	data: STOCK_PAYLOAD,
	meta: { cachedAt: 1_788_220_800, source: 'finnhub', stale: false }
};
