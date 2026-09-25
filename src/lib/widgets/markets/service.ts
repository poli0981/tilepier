import {
	CRYPTO_RANGES,
	STOCK_RANGES,
	type TpApiMeta,
	type TpCryptoCandle,
	type TpCryptoInterval,
	type TpCryptoKlinesPayload,
	type TpCryptoQuote,
	type TpCryptoRange,
	type TpCryptoTickerPayload,
	type TpStockInterval,
	type TpStockQuote,
	type TpStockQuotePayload,
	type TpStockRange,
	type TpStockSearchPayload,
	type TpStockSeriesPayload
} from '$lib/api-types';
import { fetchEnvelope } from '$lib/core/api';
import { logEntry } from '$lib/core/log-buffer';
import { swr, type TpSwrFetcher, type TpSwrHandle } from '$lib/core/swr.svelte';
import type { TpTileStatus } from '$lib/core/tile-status';
import type { TpSourceState } from '$lib/core/tile-view';
import { db as defaultDb, type TpDb } from '$lib/core/storage/db';
import {
	CACHE_POLICY,
	cacheKey,
	cryptoKlinesFamily,
	isMarketSymbol,
	stockSearchText,
	stockSeriesFamily,
	symbolSetKey
} from '$lib/shared-constants';
import {
	CRYPTO_TOP_LIST,
	MARKETS_DEFAULTS,
	MAX_DISPLAY,
	MAX_WATCHLIST,
	type TpMarketKind,
	type TpMarketsSettings,
	type TpWatchEntry
} from './types';

/**
 * The markets tile's data layer — the tier-2 pattern's third proof, and the
 * first widget that reads from **two** endpoints for one tile: the crypto set
 * from Binance.US through `/api/crypto/ticker`, the stock set from Finnhub through
 * `/api/stock/quote` (doc 09 §1).
 *
 * Pure but for the `*Source` functions and `peekSparkline`, so every decision
 * the tile makes is testable in the node project without a DOM.
 */

export interface TpTickerReading {
	payload: TpCryptoTickerPayload;
	meta: TpApiMeta;
}

export interface TpStockReading {
	payload: TpStockQuotePayload;
	meta: TpApiMeta;
}

/* ──────────────────────────────────────────────────────────────── settings */

function readKind(value: unknown): TpMarketKind | null {
	return value === 'crypto' || value === 'stock' ? value : null;
}

function readEntry(value: unknown): TpWatchEntry | null {
	if (typeof value !== 'object' || value === null) return null;
	const bag = value as Record<string, unknown>;

	const kind = readKind(bag['kind']);
	if (kind === null) return null;

	const raw = bag['symbol'];
	if (typeof raw !== 'string') return null;
	const symbol = raw.trim().toUpperCase();
	if (!isMarketSymbol(symbol)) return null;

	const label = bag['display'];
	const display = typeof label === 'string' ? label.trim().slice(0, MAX_DISPLAY) : '';

	return { kind, symbol, display };
}

/**
 * Fail-closed, in the style of `weather/service.ts` and `currency/service.ts`:
 * a settings bag hand-edited into the layout, or written by an older build,
 * must land on a working tile rather than take the tile down.
 *
 * **An empty watchlist is kept**, because a reader can legitimately remove
 * every row — that is doc 06 §3's `empty` state and the tile renders guidance
 * for it. Only a bag carrying something that is not a list at all falls back to
 * the defaults, which is the same rule `readTargets` follows in currency.
 *
 * De-duplicated on `kind:symbol` rather than on `symbol`, because `AAPL` the
 * stock and a hypothetical `AAPL` elsewhere are different questions to
 * different upstreams.
 */
export function readSettings(bag: Record<string, unknown>): TpMarketsSettings {
	const raw = bag['watchlist'];
	if (!Array.isArray(raw)) return { watchlist: [...MARKETS_DEFAULTS.watchlist] };

	const seen = new Set<string>();
	const watchlist: TpWatchEntry[] = [];

	for (const value of raw) {
		const entry = readEntry(value);
		if (entry === null) continue;

		const id = entryId(entry);
		if (seen.has(id)) continue;
		seen.add(id);
		watchlist.push(entry);

		if (watchlist.length >= MAX_WATCHLIST) break;
	}

	return { watchlist };
}

/**
 * One row's identity: `crypto:BTCUSDT`, `stock:AAPL`.
 *
 * Every place that picks, keys or removes a row goes through this rather than
 * through the symbol, because the symbol alone is not unique on a watchlist
 * that holds both kinds — `readSettings` de-duplicates on the pair, so anything
 * that looks a row up on half of it can land on the wrong one.
 */
export function entryId(entry: Pick<TpWatchEntry, 'kind' | 'symbol'>): string {
	return `${entry.kind}:${entry.symbol}`;
}

/** What a row is called: the reader's rename, or the symbol they never renamed. */
export function labelOf(entry: TpWatchEntry): string {
	return entry.display === '' ? entry.symbol : entry.display;
}

export function symbolsOf(
	watchlist: readonly TpWatchEntry[],
	kind: TpMarketKind
): readonly string[] {
	return watchlist.filter((entry) => entry.kind === kind).map((entry) => entry.symbol);
}

/* ─────────────────────────────────────────────────────────── the quote sources */

/**
 * The data key, spelled the way the Worker spells it (doc 04 §5).
 *
 * `symbolSetKey` canonicalises before joining, so a reader who drags `ETHUSDT`
 * above `BTCUSDT` does not move the key — the watchlist order is a display
 * concern and the cache is about the *set*.
 */
export function tickerKey(symbols: readonly string[]): string {
	return cacheKey.cryptoTicker(symbolSetKey(symbols));
}

/**
 * The canonical set goes up too, not the reader's order.
 *
 * The endpoint would canonicalise it for the KV key either way, but the
 * *response* is CDN-cacheable by URL — so sending the display order would give
 * every arrangement of the same watchlist its own edge entry for the same
 * answer.
 */
export function tickerUrl(symbols: readonly string[]): string {
	const params = new URLSearchParams({ symbols: symbolSetKey(symbols) });
	return `/api/crypto/ticker?${params.toString()}`;
}

/** The stock twin of `tickerKey`: one client entry per canonical set, where the
 *  Worker keeps one KV entry per symbol (doc 11 §4). */
export function stockQuotesKey(symbols: readonly string[]): string {
	return cacheKey.stockQuotes(symbolSetKey(symbols));
}

export function stockQuotesUrl(symbols: readonly string[]): string {
	const params = new URLSearchParams({ symbols: symbolSetKey(symbols) });
	return `/api/stock/quote?${params.toString()}`;
}

/** An envelope's `data` and `meta`, which is what every reading here stores. */
function reader<P>(url: string): TpSwrFetcher<{ payload: P; meta: TpApiMeta }> {
	return async (signal) => {
		const result = await fetchEnvelope<P>(url, signal);
		return { payload: result.data, meta: result.meta };
	};
}

/**
 * Subscribe to the crypto rows of a watchlist.
 *
 * **`null` when there are none**, which is the case a watchlist of stocks
 * reaches. Returning a handle anyway would fetch `?symbols=` — a `BAD_REQUEST`
 * once a minute, forever, for an answer nobody asked for.
 *
 * `target` is threaded through so a component test can drive a throwaway Dexie
 * rather than the reader's own, the way `weather` and `currency` do.
 */
export function cryptoSource(
	symbols: readonly string[],
	target?: TpDb
): TpSwrHandle<TpTickerReading> | null {
	if (symbols.length === 0) return null;

	// doc 04 §2: the client window is the Worker's KV TTL, which is the floor —
	// a shorter one would revalidate into a guaranteed HIT. The 60 s cadence in
	// doc 06 §7 is deliberately longer than this 30 s window, so a tick that
	// comes due always has something to ask for.
	const options = { ttlMs: CACHE_POLICY.crTick.ttlMs };
	const key = tickerKey(symbols);
	const fetcher = reader<TpCryptoTickerPayload>(tickerUrl(symbols));

	return target === undefined
		? swr<TpTickerReading>(key, fetcher, options)
		: swr<TpTickerReading>(key, fetcher, options, target);
}

/**
 * Subscribe to the stock rows of a watchlist — `null` when there are none, for
 * `cryptoSource`'s reason.
 *
 * The window is Finnhub's 90 s KV TTL, which is *longer* than the tile's 60 s
 * cadence: a tick that finds the entry fresh re-asks anyway (`revalidate` does
 * not consult the window) and the Worker answers from KV, so Finnhub hears from
 * this set at most every 90 s however many readers are watching it.
 */
export function stockSource(
	symbols: readonly string[],
	target?: TpDb
): TpSwrHandle<TpStockReading> | null {
	if (symbols.length === 0) return null;

	const options = { ttlMs: CACHE_POLICY.stQuote.ttlMs };
	const key = stockQuotesKey(symbols);
	const fetcher = reader<TpStockQuotePayload>(stockQuotesUrl(symbols));

	return target === undefined
		? swr<TpStockReading>(key, fetcher, options)
		: swr<TpStockReading>(key, fetcher, options, target);
}

/* ─────────────────────────────────────────────────────────────────── rows */

/**
 * What a row shows, whichever upstream answered for it.
 *
 * The two quote shapes differ where the markets do — a coin trades around the
 * clock and reports a rolling 24 h, a stock reports its session against the
 * previous close — and the row renders the same four facts from either.
 */
export interface TpRowQuote {
	price: number;
	/**
	 * A fraction. **Over 24 h for a coin, against the previous close for a
	 * stock** (doc 09 §1's "24 h (crypto) / day (stock)"), and the tile labels
	 * it accordingly rather than calling both "24 h".
	 */
	change: number | null;
	low: number | null;
	high: number | null;
	/** Unix ms of the last trade. */
	at: number;
}

function fromCrypto(quote: TpCryptoQuote): TpRowQuote {
	return {
		price: quote.price,
		change: quote.change24h,
		low: quote.low24h,
		high: quote.high24h,
		at: quote.at
	};
}

function fromStock(quote: TpStockQuote): TpRowQuote {
	return {
		price: quote.price,
		change: quote.changeDay,
		low: quote.low,
		high: quote.high,
		at: quote.at
	};
}

/**
 * One quote source, as the rows and the tile need to see it.
 *
 * `quotes` is `undefined` until a payload has arrived — or while the only one
 * on the device is past `swr`'s hard ceiling, which `data` already hides.
 */
export interface TpSide extends TpSourceState {
	quotes: Readonly<Record<string, TpRowQuote | null>> | undefined;
	/** The Worker's own staleness flag (doc 11 §4), which `swr` cannot see. */
	servedStale: boolean;
	cachedAt: number | undefined;
}

type TpHandleView<T> = Pick<TpSwrHandle<T>, 'data' | 'status' | 'cachedAt'>;

function sideOf<Q>(
	handle: TpHandleView<{ payload: { quotes: Record<string, Q | null> }; meta: TpApiMeta }>,
	convert: (quote: Q) => TpRowQuote
): TpSide {
	const reading = handle.data;
	let quotes: Record<string, TpRowQuote | null> | undefined;
	if (reading !== undefined) {
		quotes = {};
		for (const [symbol, quote] of Object.entries(reading.payload.quotes)) {
			quotes[symbol] = quote === null ? null : convert(quote);
		}
	}
	return {
		quotes,
		// `core/tile-view`'s question — is anything of this side on screen.
		shown: quotes !== undefined,
		status: handle.status,
		servedStale: reading?.meta.stale === true,
		cachedAt: handle.cachedAt
	};
}

export function cryptoSide(handle: TpHandleView<TpTickerReading>): TpSide {
	return sideOf(handle, fromCrypto);
}

export function stockSide(handle: TpHandleView<TpStockReading>): TpSide {
	return sideOf(handle, fromStock);
}

/**
 * What one line of the tile knows.
 *
 * A row can be in a state of its own now that one tile reads two sources: the
 * crypto set can have answered while the stock set is still on its way, or has
 * failed with nothing cached, and neither of those is "upstream had nothing for
 * this symbol". Before 5b a row could only be quoted or not, because one
 * request answered for all of them.
 */
type TpRowState =
	| { kind: 'quoted'; quote: TpRowQuote }
	/** Its source answered and had nothing for it — doc 09 §1's delisted case,
	 *  and the one the row's remove shortcut is for. */
	| { kind: 'absent' }
	/** Its source has not answered yet. */
	| { kind: 'waiting' }
	/** Its source failed and has nothing cached to show instead. */
	| { kind: 'unread' };

export interface TpMarketRow {
	entry: TpWatchEntry;
	label: string;
	state: TpRowState;
}

export type TpSides = Readonly<Record<TpMarketKind, TpSide | null>>;

function stateOf(entry: TpWatchEntry, side: TpSide | null): TpRowState {
	const quotes = side?.quotes;
	if (quotes !== undefined) {
		// `hasOwn`, not `in` or a bare index: the payload is parsed JSON, and a
		// symbol that happens to name something on `Object.prototype` must read as
		// "not quoted" rather than as a function.
		const quote = Object.hasOwn(quotes, entry.symbol) ? quotes[entry.symbol] : null;
		return quote == null ? { kind: 'absent' } : { kind: 'quoted', quote };
	}
	const pending = side === null || side.status === 'loading' || side.status === 'idle';
	return pending ? { kind: 'waiting' } : { kind: 'unread' };
}

/** The tile's rows, in the reader's order. */
export function rowsFor(watchlist: readonly TpWatchEntry[], sides: TpSides): TpMarketRow[] {
	return watchlist.map((entry) => ({
		entry,
		label: labelOf(entry),
		state: stateOf(entry, sides[entry.kind])
	}));
}

type TpBadgeKind = TpTileStatus['kind'];

const SEVERITY: Readonly<Record<TpBadgeKind, number>> = {
	stale: 1,
	'stale-error': 2,
	offline: 3
};

/**
 * doc 13 §7's host badge for the whole tile: the most worrying of its sides',
 * with **that side's** age — the badge is a claim about particular prices, and
 * an age taken from the healthier side would understate it.
 *
 * Only sides with something on screen count. A side that failed with nothing
 * cached is already saying so in its own rows, and a badge that says "stale"
 * about prices that are not there would be describing nothing.
 */
export function tileBadge(
	sides: readonly TpSide[]
): { kind: TpBadgeKind; cachedAt: number | undefined } | null {
	let worst: { kind: TpBadgeKind; cachedAt: number | undefined } | null = null;

	for (const side of sides) {
		if (side.quotes === undefined) continue;

		let kind: TpBadgeKind | null = null;
		if (side.status === 'offline') kind = 'offline';
		else if (side.status === 'stale-error' || side.status === 'rate-limited') kind = 'stale-error';
		else if (side.status === 'stale' || side.servedStale) kind = 'stale';
		if (kind === null) continue;

		if (worst === null || SEVERITY[kind] > SEVERITY[worst.kind]) {
			worst = { kind, cachedAt: side.cachedAt };
		}
	}

	return worst;
}

/** The oldest of the prices on screen — what the tier-L footer dates, because
 *  "prices 2 minutes ago" is a claim about every row under it. */
export function oldestAt(sides: readonly TpSide[]): number | undefined {
	let oldest: number | undefined;
	for (const side of sides) {
		if (side.quotes === undefined || side.cachedAt === undefined) continue;
		if (oldest === undefined || side.cachedAt < oldest) oldest = side.cachedAt;
	}
	return oldest;
}

/**
 * How long a stock's last trade may be quiet before its row says "at the
 * close" (doc 09 §1's edge case).
 *
 * **From the quote's own timestamp, not from a market calendar.** A calendar
 * is a holiday list somebody has to keep, and it is still wrong about the one
 * case that matters — a halted stock is "closed" to a reader whatever the
 * exchange's hours say. Finnhub stamps a quote with its last trade, which in
 * session is seconds old for anything a watchlist would hold and outside it is
 * the close. Half an hour separates the two with room for a quiet small cap,
 * and a quote the Worker served stale is dated by the host badge regardless.
 */
export const CLOSE_QUIET_MS = 30 * 60 * 1000;

/** Coins trade around the clock, so only a stock is ever "at the close". */
export function atClose(kind: TpMarketKind, quote: TpRowQuote, now: number): boolean {
	return kind === 'stock' && now - quote.at > CLOSE_QUIET_MS;
}

/**
 * doc 09 §1's per-asset precision, as an `Intl` option set.
 *
 * "BTC 2 dp, sub-$1 alts 4–6 dp, stocks 2 dp" — keyed off the *price* rather
 * than off the symbol, because the rule is about magnitude and a hard-coded
 * list of coins would be wrong the first week a new one is added. Sub-cent
 * prices get six places; under a dollar, four; above it, two.
 */
export function priceDigits(price: number): number {
	if (price < 0.01) return 6;
	if (price < 1) return 4;
	return 2;
}

/* ────────────────────────────────────────────────────────── the candle sources */

export interface TpKlinesReading {
	payload: TpCryptoKlinesPayload;
	meta: TpApiMeta;
}

export interface TpStockSeriesReading {
	payload: TpStockSeriesPayload;
	meta: TpApiMeta;
}

/**
 * The ranges the detail's picker offers, for either kind.
 *
 * An intersection, so the two range tables can only be offered where they
 * agree: a range added to one of them and not the other is not offered at all,
 * rather than offered and answered with a `BAD_REQUEST` for one kind.
 */
export type TpMarketRange = TpCryptoRange & TpStockRange;

export const MARKET_RANGES: readonly TpMarketRange[] = Object.keys(CRYPTO_RANGES).filter(
	(key): key is TpMarketRange => Object.hasOwn(STOCK_RANGES, key)
);

/**
 * The depth an interval is **always** asked for: the deepest range over it.
 *
 * Two ranges over one interval share a data key — 1M and 1Y are both daily
 * candles, and doc 11 §4 keys a series by symbol and interval only. Until
 * 2026-09-23 each range sent its own `limit`, which made the key name two
 * different responses. The second range opened read the first one's window out
 * of `apiCache` as fresh and drew it under its own label: a year captioned 1M,
 * or a month captioned 1Y, until the entry went stale.
 *
 * Asking for the deepest window every time makes the key *be* the request
 * again, which is what `swr`'s de-duplication assumes. It costs nothing
 * upstream: the Worker holds one deep series per interval whatever the window,
 * and Twelve Data charges a credit a call rather than a candle. It costs the
 * reader a few kilobytes on a 1M view. The range picker windows the answer
 * with `windowOf` instead.
 */
function deepest<I extends string>(
	ranges: Readonly<Record<string, { readonly interval: I; readonly limit: number }>>,
	interval: I
): number {
	let depth = 0;
	for (const range of Object.values(ranges)) {
		if (range.interval === interval && range.limit > depth) depth = range.limit;
	}
	return depth;
}

/** The last `limit` candles — a range's window onto the deep series its
 *  interval is always fetched at. */
export function windowOf(
	candles: readonly TpCryptoCandle[],
	limit: number
): readonly TpCryptoCandle[] {
	return candles.length <= limit ? candles : candles.slice(-limit);
}

/**
 * The candle data key.
 *
 * **Keyed by symbol and interval, with no range in it** — the same string the
 * Worker uses (doc 11 §4), which is what makes doc 04 §5's 1:1 guarantee hold
 * for this payload too. Two ranges sharing an interval share a client entry as
 * well as a KV one, and `deepest` is what makes that sharing honest.
 */
export function klinesKey(symbol: string, interval: TpCryptoInterval): string {
	return cacheKey.cryptoKlines(symbol, interval);
}

export function klinesUrl(symbol: string, interval: TpCryptoInterval, limit: number): string {
	const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
	return `/api/crypto/klines?${params.toString()}`;
}

/** Subscribe to the deep series under one crypto range; `windowOf` cuts the
 *  range out of it. */
export function klinesSource(
	symbol: string,
	range: TpCryptoRange,
	target?: TpDb
): TpSwrHandle<TpKlinesReading> {
	const { interval } = CRYPTO_RANGES[range];
	const key = klinesKey(symbol, interval);
	const fetcher = reader<TpCryptoKlinesPayload>(
		klinesUrl(symbol, interval, deepest(CRYPTO_RANGES, interval))
	);

	// The client window is the Worker's KV TTL for this interval's family, which
	// doc 04 §2 makes the floor.
	const ttlMs = CACHE_POLICY[cryptoKlinesFamily(interval)].ttlMs;

	return target === undefined
		? swr<TpKlinesReading>(key, fetcher, { ttlMs })
		: swr<TpKlinesReading>(key, fetcher, { ttlMs }, target);
}

export function stockSeriesKey(symbol: string, interval: TpStockInterval): string {
	return cacheKey.stockSeries(symbol, interval);
}

export function stockSeriesUrl(symbol: string, interval: TpStockInterval, limit: number): string {
	const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
	return `/api/stock/series?${params.toString()}`;
}

/**
 * Subscribe to the deep stock series under one range.
 *
 * **Only ever from the detail** — doc 11 §5's "series fetched only when a
 * detail view opens (not for tiles)" is what keeps Twelve Data's 800 credits a
 * day true, and the tile's sparkline peeks instead (`peekSparkline`).
 */
export function stockSeriesSource(
	symbol: string,
	range: TpStockRange,
	target?: TpDb
): TpSwrHandle<TpStockSeriesReading> {
	const { interval } = STOCK_RANGES[range];
	const key = stockSeriesKey(symbol, interval);
	const fetcher = reader<TpStockSeriesPayload>(
		stockSeriesUrl(symbol, interval, deepest(STOCK_RANGES, interval))
	);
	const ttlMs = CACHE_POLICY[stockSeriesFamily(interval)].ttlMs;

	return target === undefined
		? swr<TpStockSeriesReading>(key, fetcher, { ttlMs })
		: swr<TpStockSeriesReading>(key, fetcher, { ttlMs }, target);
}

/**
 * doc 09 §1's ladder, at its last two rungs, for a range the reader picked.
 *
 * 1D is intraday, and doc 11 §5 stops intraday first — at 720 credits, where
 * daily carries on to 780. Between the two the Worker answers 1D with
 * `QUOTA_EXHAUSTED` when it has nothing stale, and the detail collapses to the
 * daily week rather than drawing an empty intraday chart.
 */
export function stockRangeFor(picked: TpStockRange, intradayRefused: boolean): TpStockRange {
	return picked === '1D' && intradayRefused ? '1W' : picked;
}

/* ──────────────────────────────────────────────── the stock search (doc 09 §1) */

export interface TpSearchReading {
	payload: TpStockSearchPayload;
	meta: TpApiMeta;
}

/** A single letter matches half the exchange. Two is where a search starts
 *  narrowing; a one-letter ticker (`F`, `T`) is still added by typing it. */
const SEARCH_MIN = 2;

/**
 * What the search box would ask for, or `null` for nothing worth asking.
 *
 * The Worker's own rule (`stockSearchText`), lower-cased: the response is
 * CDN-cacheable by URL and the KV key is the lower-cased query, so sending the
 * reader's capitalisation would give "Apple" and "apple" two edge entries for
 * one answer.
 */
export function searchTerm(raw: string): string | null {
	const text = stockSearchText(raw);
	if (text === null || text.length < SEARCH_MIN) return null;
	return text.toLowerCase();
}

export function searchKey(term: string): string {
	return cacheKey.stockSearch(term);
}

export function searchUrl(term: string): string {
	return `/api/stock/search?${new URLSearchParams({ q: term }).toString()}`;
}

/** Subscribe to one search. The day-long window is the Worker's (doc 11 §4): a
 *  company's ticker rarely moves, and every miss is a Finnhub call. */
export function searchSource(term: string, target?: TpDb): TpSwrHandle<TpSearchReading> {
	const options = { ttlMs: CACHE_POLICY.stSearch.ttlMs };
	const fetcher = reader<TpStockSearchPayload>(searchUrl(term));

	return target === undefined
		? swr<TpSearchReading>(searchKey(term), fetcher, options)
		: swr<TpSearchReading>(searchKey(term), fetcher, options, target);
}

/* ──────────────────────────────────────────── the tile sparkline (doc 09 §1) */

/**
 * How many points a micro-sparkline is worth drawing.
 *
 * Twenty-four across roughly forty pixels: past that the polyline is drawing
 * segments narrower than a stroke, and the shape stops being readable before
 * the data runs out.
 */
export const SPARK_POINTS = 24;

/**
 * How old a cached coin series may be and still be drawn beside a live price.
 *
 * `swr`'s own ceiling is seven days (`HARD_MAX_AGE_MS`), which is right for a
 * payload that *is* the reading and wrong for one sitting next to a fresher
 * one: a week-old shape under a current price reads as this morning. Six hours
 * is the klines stale window from doc 11 §4 — past it the endpoint would not
 * serve these candles either.
 */
export const SPARK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Per kind, because the markets keep different hours. A stock's series goes
 * quiet with its exchange, so its window is the intraday series' own stale
 * window (doc 11 §4) — a day. Six hours would blank every stock sparkline
 * overnight while nothing it showed had changed.
 */
const SPARK_MAX_AGE: Readonly<Record<TpMarketKind, number>> = {
	crypto: SPARK_MAX_AGE_MS,
	stock: CACHE_POLICY.stSeries15min.staleMs
};

/**
 * Finest first. Whichever the reader last opened a detail on is what is
 * cached, and a sparkline is about the *shape* of recent trading rather than
 * about a particular bucket size — so requiring one interval would make the
 * feature depend on which range somebody happened to click.
 */
const SPARK_KEYS: Readonly<Record<TpMarketKind, (symbol: string) => string[]>> = {
	crypto: (symbol) =>
		(['5m', '15m', '1h', '1d'] as const).map((interval) => klinesKey(symbol, interval)),
	stock: (symbol) =>
		(['15min', '1day'] as const).map((interval) => stockSeriesKey(symbol, interval))
};

/**
 * Closing prices, thinned to at most `points`.
 *
 * The **last** point is always kept: a sparkline whose right-hand end is not
 * the latest close would disagree with the price rendered beside it, which is
 * the one inconsistency a reader would actually notice.
 */
export function downsample(candles: readonly TpCryptoCandle[], points = SPARK_POINTS): number[] {
	if (candles.length === 0) return [];
	if (candles.length <= points) return candles.map((candle) => candle[4]);

	const step = (candles.length - 1) / (points - 1);
	const out: number[] = [];
	for (let i = 0; i < points; i++) {
		const candle = candles[Math.round(i * step)];
		if (candle !== undefined) out.push(candle[4]);
	}
	return out;
}

/**
 * The sparkline's data, read straight out of `apiCache` — **never fetched**.
 *
 * doc 09 §1 asks for "no extra fetch: reuse the series cache", and doc 11 §5
 * makes that load bearing rather than tidy: "series fetched only when a detail
 * view opens (not for tiles)" is what keeps the Twelve Data quota model true,
 * and a tile that subscribed through `swr()` would revalidate on its own 60 s
 * cadence for every symbol on the watchlist.
 *
 * So this is a **peek**: one Dexie read per interval, no subscription, no entry
 * in the dedupe map, nothing for the scheduler to wake. The consequence is that
 * a sparkline is *absent until the reader has opened that symbol's detail at
 * least once*, and absent is a normal state rather than a fault — the tile
 * simply renders the row without one.
 *
 * Returns `[]` rather than throwing: a sparkline that cannot be drawn is a
 * state the tile already has, and doc 05 §5's readers all fail closed.
 */
export async function peekSparkline(
	entry: Pick<TpWatchEntry, 'kind' | 'symbol'>,
	now: number,
	target: TpDb | undefined = defaultDb
): Promise<number[]> {
	try {
		for (const key of SPARK_KEYS[entry.kind](entry.symbol)) {
			const row = await target.apiCache.get(key);
			if (row === undefined) continue;
			if (now - row.cachedAt > SPARK_MAX_AGE[entry.kind]) continue;

			const reading = row.payload as TpKlinesReading | TpStockSeriesReading | undefined;
			const candles = reading?.payload.candles;
			if (!Array.isArray(candles) || candles.length === 0) continue;

			return downsample(candles);
		}
		return [];
	} catch (error) {
		logEntry('warn', `could not read cached candles for ${entry.symbol}`, {
			src: 'widget',
			error
		});
		return [];
	}
}

/**
 * A polyline's `points` attribute for a `width` x `height` box, or `''` when
 * there is nothing to draw.
 *
 * Scaled to the series' own min and max rather than to zero, for the reason the
 * detail's y axis sets `scale: true`: a market that moved 0.4 % in a day is a
 * flat line against an axis anchored at zero, and a flat line is exactly the
 * thing a sparkline is supposed to disprove.
 *
 * A series with no spread at all draws down the middle, which is honest — it
 * really did not move.
 */
export function sparklinePoints(values: readonly number[], width: number, height: number): string {
	if (values.length < 2) return '';

	let low = values[0] as number;
	let high = low;
	for (const value of values) {
		if (value < low) low = value;
		if (value > high) high = value;
	}

	const spread = high - low;
	const stepX = width / (values.length - 1);

	return values
		.map((value, i) => {
			const x = i * stepX;
			// SVG's y grows downward, so the highest price is the smallest y.
			const y = spread === 0 ? height / 2 : height - ((value - low) / spread) * height;
			return `${x.toFixed(2)},${y.toFixed(2)}`;
		})
		.join(' ');
}

/* ────────────────────────────────────── the watchlist manager (doc 09 §1) */

/**
 * Why an edit was refused, or `null` when it was not.
 *
 * A discriminated reason rather than a bare `null` list, because the panel has
 * something different to say about each: a full watchlist is a limit the reader
 * can act on by removing a row, a duplicate is already on screen, and a
 * malformed symbol is a typo. One "could not add that" for all three would send
 * a reader looking for the wrong problem.
 */
export type TpWatchlistRefusal = 'invalid' | 'duplicate' | 'full';

export interface TpWatchlistEdit {
	watchlist: TpWatchEntry[];
	refused: TpWatchlistRefusal | null;
}

/** Unchanged, with a reason. Keeps every caller on one shape. */
function refuse(watchlist: readonly TpWatchEntry[], reason: TpWatchlistRefusal): TpWatchlistEdit {
	return { watchlist: [...watchlist], refused: reason };
}

/**
 * Appends a symbol, or explains why it could not.
 *
 * Validation is `isMarketSymbol` — doc 10 §5's allowlist, the same one the
 * endpoints refuse against — rather than a check of whether the symbol exists.
 * Nothing on the client can know that, and doc 09 §1 already has a rendering
 * for a symbol upstream will not quote: the row appears and is marked, with a
 * shortcut to remove it. Guessing here would refuse a coin listed this morning.
 */
export function addToWatchlist(
	watchlist: readonly TpWatchEntry[],
	kind: TpMarketKind,
	raw: string
): TpWatchlistEdit {
	const symbol = raw.trim().toUpperCase();
	if (!isMarketSymbol(symbol)) return refuse(watchlist, 'invalid');
	if (watchlist.some((entry) => entry.kind === kind && entry.symbol === symbol)) {
		return refuse(watchlist, 'duplicate');
	}
	if (watchlist.length >= MAX_WATCHLIST) return refuse(watchlist, 'full');

	return { watchlist: [...watchlist, { kind, symbol, display: '' }], refused: null };
}

export function removeFromWatchlist(
	watchlist: readonly TpWatchEntry[],
	kind: TpMarketKind,
	symbol: string
): TpWatchEntry[] {
	return watchlist.filter((entry) => !(entry.kind === kind && entry.symbol === symbol));
}

/**
 * Moves one row by `delta`, or returns the list unchanged at either end.
 *
 * Unchanged rather than wrapped: a reader pressing "up" on the first row means
 * "nothing above this", and jumping it to the bottom is a different action than
 * the one they asked for.
 */
export function moveInWatchlist(
	watchlist: readonly TpWatchEntry[],
	index: number,
	delta: number
): TpWatchEntry[] {
	const target = index + delta;
	if (index < 0 || index >= watchlist.length) return [...watchlist];
	if (target < 0 || target >= watchlist.length) return [...watchlist];

	const next = [...watchlist];
	const moved = next[index] as TpWatchEntry;
	next[index] = next[target] as TpWatchEntry;
	next[target] = moved;
	return next;
}

/** The top-list entries not already on the watchlist — what the picker offers.
 *  Empty means the reader has taken all of them, which the panel says rather
 *  than rendering an empty control. */
export function suggestions(watchlist: readonly TpWatchEntry[]): string[] {
	const held = new Set(symbolsOf(watchlist, 'crypto'));
	return CRYPTO_TOP_LIST.filter((symbol) => !held.has(symbol));
}
