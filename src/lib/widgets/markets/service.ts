import {
	CRYPTO_RANGES,
	type TpApiMeta,
	type TpCryptoCandle,
	type TpCryptoInterval,
	type TpCryptoKlinesPayload,
	type TpCryptoQuote,
	type TpCryptoRange,
	type TpCryptoTickerPayload
} from '$lib/api-types';
import { fetchEnvelope } from '$lib/core/api';
import { logEntry } from '$lib/core/log-buffer';
import { swr, type TpSwrFetcher, type TpSwrHandle } from '$lib/core/swr.svelte';
import { db as defaultDb, type TpDb } from '$lib/core/storage/db';
import {
	CACHE_POLICY,
	cacheKey,
	cryptoKlinesFamily,
	isMarketSymbol,
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
 * first widget that reads from **two** endpoints.
 *
 * Pure but for `cryptoSource`, so every decision the tile makes is testable in
 * the node project without a DOM.
 *
 * Week 5a covers the crypto half. The stock half is the same shape against
 * `/api/stock/quote` and lands in 5b; the row model below is already written
 * for both, which is why `rowsFor` takes a lookup rather than a payload.
 */

export interface TpTickerReading {
	payload: TpCryptoTickerPayload;
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

		const id = `${entry.kind}:${entry.symbol}`;
		if (seen.has(id)) continue;
		seen.add(id);
		watchlist.push(entry);

		if (watchlist.length >= MAX_WATCHLIST) break;
	}

	return { watchlist };
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

/* ────────────────────────────────────────────────────────── the crypto source */

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

/** Not exported: `cryptoSource` is the only caller, and knip is CI-blocking on
 *  an export nothing imports. */
function fetchTicker(symbols: readonly string[]): TpSwrFetcher<TpTickerReading> {
	return async (signal) => {
		const result = await fetchEnvelope<TpCryptoTickerPayload>(tickerUrl(symbols), signal);
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
	const fetcher = fetchTicker(symbols);

	return target === undefined
		? swr<TpTickerReading>(key, fetcher, options)
		: swr<TpTickerReading>(key, fetcher, options, target);
}

/* ─────────────────────────────────────────────────────────────────── rows */

/**
 * What one line of the tile knows.
 *
 * `quote` is `null` for two different reasons and the tile says the same thing
 * about both, deliberately: upstream answered and had nothing for this symbol
 * (doc 09 §1's delisted case), or nothing has arrived yet. The difference is
 * carried by the widget's own status, not per row — a row cannot be
 * individually loading when one request answers for all of them.
 */
export interface TpMarketRow {
	entry: TpWatchEntry;
	label: string;
	quote: TpCryptoQuote | null;
}

/**
 * The tile's rows, in the reader's order.
 *
 * Takes a lookup rather than a payload so the stock half can supply its own in
 * 5b without this function learning about a second payload shape.
 */
export function rowsFor(
	watchlist: readonly TpWatchEntry[],
	lookup: (entry: TpWatchEntry) => TpCryptoQuote | null
): TpMarketRow[] {
	return watchlist.map((entry) => ({ entry, label: labelOf(entry), quote: lookup(entry) }));
}

/** The lookup for the crypto half. A payload that has not arrived answers
 *  `null` for everything, which is what the loading tile renders. */
export function cryptoLookup(
	payload: TpCryptoTickerPayload | undefined
): (entry: TpWatchEntry) => TpCryptoQuote | null {
	return (entry) => {
		if (payload === undefined || entry.kind !== 'crypto') return null;
		return payload.quotes[entry.symbol] ?? null;
	};
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

/* ────────────────────────────────────────────────────────── the candle source */

export interface TpKlinesReading {
	payload: TpCryptoKlinesPayload;
	meta: TpApiMeta;
}

/**
 * The candle data key.
 *
 * **Keyed by symbol and interval, with no range in it** — the same string the
 * Worker uses (doc 11 §4), which is what makes doc 04 §5's 1:1 guarantee hold
 * for this payload too. Two ranges sharing an interval therefore share a client
 * cache entry as well as a KV one, and both hold the deep series the endpoint
 * windows: 1M and 1Y are one subscription, and switching between them is free
 * and offline-capable.
 */
export function klinesKey(symbol: string, interval: TpCryptoInterval): string {
	return cacheKey.cryptoKlines(symbol, interval);
}

export function klinesUrl(symbol: string, interval: TpCryptoInterval, limit: number): string {
	const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
	return `/api/crypto/klines?${params.toString()}`;
}

/**
 * Subscribe to one symbol's candles for one range.
 *
 * **The key omits the range and the request does not**, which is the one place
 * the two spellings legitimately differ. The endpoint answers a window onto a
 * deep entry, so the *response* differs by range while the *entry* does not —
 * and `swr` caches what it was handed. Two ranges over one interval therefore
 * share a key and the later one overwrites the earlier's window, which is
 * correct: they are the same candles, and the wider request is a superset.
 */
export function klinesSource(
	symbol: string,
	range: TpCryptoRange,
	target?: TpDb
): TpSwrHandle<TpKlinesReading> {
	const { interval, limit } = CRYPTO_RANGES[range];
	const key = klinesKey(symbol, interval);

	const fetcher: TpSwrFetcher<TpKlinesReading> = async (signal) => {
		const result = await fetchEnvelope<TpCryptoKlinesPayload>(
			klinesUrl(symbol, interval, limit),
			signal
		);
		return { payload: result.data, meta: result.meta };
	};

	// The client window is the Worker's KV TTL for this interval's family, which
	// doc 04 §2 makes the floor.
	const ttlMs = CACHE_POLICY[cryptoKlinesFamily(interval)].ttlMs;

	return target === undefined
		? swr<TpKlinesReading>(key, fetcher, { ttlMs })
		: swr<TpKlinesReading>(key, fetcher, { ttlMs }, target);
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
 * How old a cached series may be and still be drawn beside a live price.
 *
 * `swr`'s own ceiling is seven days (`HARD_MAX_AGE_MS`), which is right for a
 * payload that *is* the reading and wrong for one sitting next to a fresher
 * one: a week-old shape under a current price reads as this morning. Six hours
 * is the klines stale window from doc 11 §4 — past it the endpoint would not
 * serve these candles either.
 */
export const SPARK_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Finest first. Whichever the reader last opened a detail on is what is
 *  cached, and a sparkline is about the *shape* of recent trading rather than
 *  about a particular bucket size — so requiring one interval would make the
 *  feature depend on which range somebody happened to click. */
const SPARK_INTERVALS: readonly TpCryptoInterval[] = ['5m', '15m', '1h', '1d'];

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
 * view opens (not for tiles)" is what keeps the Twelve Data quota model true in
 * 5b, and a tile that subscribed through `swr()` would revalidate on its own
 * 60 s cadence for every symbol on the watchlist.
 *
 * So this is a **peek**: one Dexie read, no subscription, no entry in the
 * dedupe map, nothing for the scheduler to wake. The consequence is that a
 * sparkline is *absent until the reader has opened that symbol's detail at
 * least once*, and absent is a normal state rather than a fault — the tile
 * simply renders the row without one.
 *
 * Returns `[]` rather than throwing: a sparkline that cannot be drawn is a
 * state the tile already has, and doc 05 §5's readers all fail closed.
 */
export async function peekSparkline(
	symbol: string,
	now: number,
	target: TpDb | undefined = defaultDb
): Promise<number[]> {
	try {
		for (const interval of SPARK_INTERVALS) {
			const row = await target.apiCache.get(klinesKey(symbol, interval));
			if (row === undefined) continue;
			if (now - row.cachedAt > SPARK_MAX_AGE_MS) continue;

			const reading = row.payload as TpKlinesReading | undefined;
			const candles = reading?.payload.candles;
			if (!Array.isArray(candles) || candles.length === 0) continue;

			return downsample(candles);
		}
		return [];
	} catch (error) {
		logEntry('warn', `could not read cached candles for ${symbol}`, { src: 'widget', error });
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
 * endpoints refuse against — rather than a check of whether the coin exists.
 * Nothing on the client can know that, and doc 09 §1 already has a rendering
 * for a symbol upstream will not quote: the row appears and is marked. Guessing
 * here would refuse a coin listed this morning.
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
	const held = new Set(
		watchlist.filter((entry) => entry.kind === 'crypto').map((entry) => entry.symbol)
	);
	return CRYPTO_TOP_LIST.filter((symbol) => !held.has(symbol));
}
