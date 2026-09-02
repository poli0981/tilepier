import { MARKETS_MAX_SYMBOLS } from '$lib/shared-constants';

/**
 * The markets tile's settings, as they sit in `tp.layout.v1[].settings`
 * (doc 05 §2) — never in Dexie, and never a schema on the manifest.
 */

/** doc 09 §1: the Worker maps crypto to Binance and stock to
 *  Finnhub/TwelveData/Stooq, so the client has to say which it means. */
export type TpMarketKind = 'crypto' | 'stock';

export interface TpWatchEntry {
	kind: TpMarketKind;
	/** Uppercase, doc 10 §5's allowlist. `BTCUSDT`, `AAPL`, `BRK.B`. */
	symbol: string;
	/** What the row is labelled. A reader can rename `BTCUSDT` to `BTC`; empty
	 *  means "use the symbol", which is what an untouched entry carries. */
	display: string;
}

export interface TpMarketsSettings {
	/** Ordered — the reader arranges it, and the tile renders it in that order
	 *  rather than in the canonical order the cache key is built from. */
	watchlist: TpWatchEntry[];
}

/**
 * doc 09 §1's default is `[BTCUSDT, ETHUSDT, AAPL, MSFT]`.
 *
 * **Week 5a ships the crypto half of it**, and that is a deviation worth
 * naming rather than hiding: `/api/stock/quote` lands in 5b, so seeding AAPL
 * and MSFT now would put two permanently unanswerable rows on a tile whose
 * whole job is to say what it knows. The two stock symbols join this list in
 * 5b with the endpoint that can answer for them; a reader who added the widget
 * before then keeps the list they have, because settings are per instance.
 */
export const MARKETS_DEFAULTS: TpMarketsSettings = {
	watchlist: [
		{ kind: 'crypto', symbol: 'BTCUSDT', display: '' },
		{ kind: 'crypto', symbol: 'ETHUSDT', display: '' }
	]
};

/**
 * doc 09 §1's "max 12 in v1 (quota model, doc 11 §7)".
 *
 * The same number as `MARKETS_MAX_SYMBOLS` because it is the same limit seen
 * from the other side — re-exported rather than restated so a hand-edited
 * `tp.layout.v1` and an `/api/*` query cannot disagree about it.
 */
export const MAX_WATCHLIST = MARKETS_MAX_SYMBOLS;

/** A rename long enough to be useful and short enough to render in a tile row. */
export const MAX_DISPLAY = 12;

/**
 * doc 09 §1's "static top-list (crypto)".
 *
 * A bundled list rather than a search, and that is the spec's own split:
 * `/api/stock/search` covers stocks, and Binance has no keyless search endpoint
 * worth the round trip for a set that changes about once a year. Twelve entries
 * because that is also the watchlist cap — a reader can take the whole list and
 * nothing more.
 *
 * USDT pairs throughout: they are what `/ticker/24hr` quotes, and mixing in a
 * USD or BUSD pair would put two prices for one coin in the same picker.
 */
export const CRYPTO_TOP_LIST: readonly string[] = [
	'BTCUSDT',
	'ETHUSDT',
	'BNBUSDT',
	'SOLUSDT',
	'XRPUSDT',
	'ADAUSDT',
	'DOGEUSDT',
	'TRXUSDT',
	'AVAXUSDT',
	'LINKUSDT',
	'DOTUSDT',
	'LTCUSDT'
];
