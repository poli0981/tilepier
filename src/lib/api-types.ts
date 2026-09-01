/**
 * Types shared by the client and the Worker (doc 03 §Module boundaries).
 *
 * This is the *only* module both sides import. `routes/api/*` must never pull
 * from `widgets/*` — server code dragging in a component graph is how a Worker
 * bundle quietly triples in size.
 */

/** doc 11 §2. */
export type TpApiErrorCode = 'UPSTREAM_DOWN' | 'RATE_LIMITED' | 'BAD_REQUEST' | 'QUOTA_EXHAUSTED';

export interface TpApiMeta {
	/** Unix seconds when the payload was fetched from upstream. */
	cachedAt: number;
	/** Which upstream produced it — `open-meteo`, `binance`, `stooq`, … */
	source: string;
	/** True when served past its TTL because upstream failed or the breaker is open. */
	stale: boolean;
}

interface TpApiOk<T> {
	ok: true;
	data: T;
	meta: TpApiMeta;
}

interface TpApiErr {
	ok: false;
	error: {
		code: TpApiErrorCode;
		retryAfterS?: number;
	};
}

export type TpApiResponse<T> = TpApiOk<T> | TpApiErr;

/** `x-tp-cache` header values (doc 11 §2). */
export type TpCacheStatus = 'HIT' | 'MISS' | 'STALE';

/* ─────────────────────────────────────────────────────── weather (doc 10 §2) */

/**
 * The normalized weather payload. **The client never sees Open-Meteo's shape**
 * — doc 10 §2 requires that, and until 2026-08-28 the endpoint passed `hourly`
 * and `daily` straight through as `unknown`, which was the opposite.
 *
 * Rows rather than columns, which is the real work of the normalisation:
 * Open-Meteo returns nine parallel arrays and a reader has to index all of them
 * in step to describe one hour. A row is the thing the UI actually renders.
 */
/**
 * A number upstream did not send.
 *
 * `normalize.ts` marks a gap with `NaN` — deliberately, because 0 °C is a
 * temperature and a gap is not. But the payload crosses `JSON.stringify` in
 * `_lib/respond.ts`, and `JSON.stringify(NaN)` is `null`. So the Worker holds
 * `NaN` and the client receives `null`, and this type has to admit both or it
 * is a lie to one of them.
 *
 * It said plain `number` until Week 4, which typechecked `row.tempC.toFixed(1)`
 * into a runtime crash on the first hour Open-Meteo left out. `normalize.test.ts`
 * asserts `NaN` in-process and structurally cannot see the wire.
 *
 * The single guard on the client is `Number.isFinite`, which is false for both
 * — `weather/service.ts` wraps it as `isGap`.
 */
export type TpMaybeNumber = number | null;

export interface TpWeatherHour {
	/** Local ISO time in `place.timezone`, as upstream returns it. No offset:
	 *  reading it with `new Date()` gives the *viewer's* zone, not the place's. */
	t: string;
	tempC: TpMaybeNumber;
	precipProb: TpMaybeNumber;
	precipMm: TpMaybeNumber;
	/** WMO code — doc 12 §6's icon set maps from this, never from a string. */
	code: TpMaybeNumber;
	windKph: TpMaybeNumber;
	windDeg: TpMaybeNumber;
	humidity: TpMaybeNumber;
	uv: TpMaybeNumber;
	pressureHpa: TpMaybeNumber;
	/** Total cloud cover, 0–100. doc 08 §1's cloud band. */
	cloudPct: TpMaybeNumber;
}

export interface TpWeatherDay {
	/** `YYYY-MM-DD`. */
	date: string;
	code: TpMaybeNumber;
	maxC: TpMaybeNumber;
	minC: TpMaybeNumber;
	/** Local ISO, same caveat as `TpWeatherHour.t`. */
	sunrise: string;
	sunset: string;
	precipProbMax: TpMaybeNumber;
}

/** doc 08 §1's AQI gauge. `null` throughout when the air-quality call failed —
 *  a nice-to-have must not cost the forecast (doc 10 §2). */
export interface TpAirQuality {
	europeanAqi: number | null;
	pm25: number | null;
	pm10: number | null;
	ozone: number | null;
	no2: number | null;
}

export interface TpWeatherPayload {
	place: { lat: number; lon: number; timezone: string };
	/**
	 * 48 hours, not the 168 upstream returns. doc 08 §1 asks for a 24-hour
	 * chart and a 12-hour sparkline, and 48 covers either from any point in the
	 * day; the other 120 are five times the payload for a view that does not
	 * exist. The daily array carries the whole week, which is what the 7-day
	 * strip needs.
	 */
	hourly: TpWeatherHour[];
	daily: TpWeatherDay[];
	air: TpAirQuality | null;
	/** Carried in the payload so the UI cannot forget it (doc 10 §2, doc 16 §5). */
	attribution: string;
}

/* ────────────────────────────────────────────────────── geocode (doc 10 §6) */

/** Photon and Nominatim normalise to the same four fields plus a kind. */
export interface TpGeocodeResult {
	/** The place's own name — `Hà Nội`, not the full address. */
	name: string;
	/** Enough context to tell two places with the same name apart. */
	displayName: string;
	lat: number;
	lon: number;
	/** Upstream's classification, lowercased. `city`, `village`, `county`… */
	type: string;
}

export interface TpGeocodePayload {
	query: string;
	results: TpGeocodeResult[];
	attribution: string;
}

/* ─────────────────────────────────────────────────────────── fx (doc 10 §3) */

/**
 * The daily rate table, and yesterday's beside it.
 *
 * One base, always USD. open.er-api.com's open endpoint is one-base-per-call,
 * so doc 11 §3 gives `/api/fx` no parameters at all and one cached call covers
 * every pair — **the cross-rate arithmetic is the client's**, `rates[to] /
 * rates[from]`. Sending a pair up would multiply the cache by 160².
 */
export interface TpFxPayload {
	/** Always `USD`. Carried anyway so a reader never has to assume it. */
	base: string;
	/** Currency code → units per 1 USD. Always contains `USD: 1`. */
	rates: Record<string, number>;
	/** Unix ms when upstream last published this table. */
	asOf: number;
	/**
	 * Unix ms of upstream's next publication, or `null` when it did not say.
	 * doc 10 §3 caps the KV TTL with it; the client does not read it.
	 */
	nextUpdateAt: number | null;
	/**
	 * Yesterday's table, for doc 08 §2's 24 h change column.
	 *
	 * `null` until a second UTC day's snapshot exists — on the day this ships
	 * there is nothing to compare against, and the detail renders **no change
	 * column** rather than a column of zeros. A 0.00 % is a claim; an absent
	 * column is the truth.
	 */
	prevRates: Record<string, number> | null;
	/** `YYYY-MM-DD` of `prevRates`, and `null` with it. */
	prevDate: string | null;
	/** Carried in the payload so the UI cannot forget it (doc 10 §3, doc 16 §5). */
	attribution: string;
}

/**
 * The permanent daily snapshot (doc 10 §3) — this *is* the currency history,
 * because no keyless API sells VND history back to us.
 *
 * An object rather than a bare rate map so a `base` can be added later without
 * a `v2` key, which for a value with no expiry would mean two eras of history
 * that cannot be read together.
 */
export interface TpFxSnapshotPayload {
	rates: Record<string, number>;
}

/**
 * The ranges `/api/fx/history` will answer for (doc 11 §3).
 *
 * Here rather than in either half, because this is the one module both sides
 * import and the allowlist is a contract between them: the Worker refuses
 * anything else, and the detail's range picker must not be able to ask for it.
 * Two copies would drift the first time a range was added.
 *
 * An allowlist rather than a bound because the response is CDN-cacheable by
 * URL, and a free integer gives 365 edge entries per pair that one client can
 * walk with a loop. doc 11 §3 carries the rest of the reasoning.
 */
export const FX_HISTORY_DAYS = [7, 30, 90, 365] as const;

/** doc 10 §3's worked example, and what the detail opens on. */
export const FX_HISTORY_DEFAULT_DAYS = 90;

/** doc 08 §2's history chart. A day upstream published nothing is a gap, and
 *  gaps are legal — the chart plots against a time axis, never an index. */
export interface TpFxHistoryPoint {
	/** `YYYY-MM-DD`, UTC. */
	date: string;
	/** Units of `quote` per 1 `base`. */
	rate: number;
}

export interface TpFxHistoryPayload {
	base: string;
	quote: string;
	/** Ascending by date, with days that have no snapshot simply absent. */
	points: TpFxHistoryPoint[];
	attribution: string;
}

/* ─────────────────────────────────────────────────────── crypto (doc 10 §4) */

/**
 * One Binance 24-hour ticker row, normalised.
 *
 * **A row exists only if it has a price**, and the fields around the price are
 * nullable individually. Both halves of that are deliberate.
 *
 * The whole row goes `null` without a usable `price` because a quote without a
 * price is not a quote — where the weather payload keeps an hour and marks the
 * missing column, since a forecast hour without a UV index is still an hour
 * worth drawing. doc 09 §1's tile has something to *say* about an absent row
 * ("delisted → row error chip with a remove shortcut") and nothing to say about
 * a price that is `null`.
 *
 * The rest are `number | null` rather than defaulted, for the reason doc 08 §2
 * gives about the currency table's change column: a substituted zero is a claim
 * about the market, and a high equal to the low is a claim about the day.
 */
export interface TpCryptoQuote {
	/** As Binance spells it, uppercase: `BTCUSDT`. */
	symbol: string;
	/** Last traded price, in the quote asset — USDT for `BTCUSDT`. */
	price: number;
	/**
	 * The 24 h move as a **fraction**: 0.021, not 2.1.
	 *
	 * The same choice `currency`'s `change24h` made and for the same reason —
	 * `Intl.NumberFormat`'s `style: 'percent'` wants a fraction, and letting it
	 * place the sign and the symbol is the difference between "+2,10 %" in
	 * Vietnamese and a hand-built string that is right in exactly one locale.
	 *
	 * `null` when upstream did not send it, never `0`. doc 08 §2 settled the
	 * same question for the currency table and the sentence transfers whole: a
	 * 0.00 % is a claim about the market, and an absent figure is the truth
	 * about what we know.
	 */
	change24h: number | null;
	high24h: number | null;
	low24h: number | null;
	/** Base-asset volume over the same window. */
	volume24h: number | null;
	/**
	 * Unix ms of the window's close, as upstream stamped it — falling back to
	 * when we asked, which is the only other instant we can honestly name. Not
	 * nullable, because a row with a price and no timestamp is still a quote,
	 * and `meta.cachedAt` carries the fetch time either way.
	 */
	at: number;
}

export interface TpCryptoTickerPayload {
	/**
	 * Keyed by symbol, one entry per **requested** symbol, so a caller can index
	 * it in its own watchlist order rather than in the canonical order the cache
	 * key is built from.
	 *
	 * `null` is doc 09 §1's per-symbol degradation: upstream answered for the
	 * others and not for this one. The doc 11 §2 envelope is all-or-nothing, so
	 * a row that failed has to be expressible *inside* `data` or the whole tile
	 * fails for one delisted coin.
	 */
	quotes: Record<string, TpCryptoQuote | null>;
	attribution: string;
}

/**
 * One candle, as doc 10 §4 asks for it: `[openTime, open, high, low, close,
 * volume]`.
 *
 * A tuple rather than an object, and the reason is the wire. A 500-candle
 * series is 3000 numbers; as objects with six keys each it is roughly three
 * times the bytes for the same information, on a payload the detail fetches
 * per range. A fixed-length tuple type also survives `noUncheckedIndexedAccess`
 * — `candle[4]` is a `number`, where an array of numbers would give
 * `number | undefined` at every read.
 *
 * `openTime` rather than close: it is what ECharts plots against and what
 * Binance orders the series by.
 */
export type TpCryptoCandle = readonly [number, number, number, number, number, number];

export interface TpCryptoKlinesPayload {
	symbol: string;
	interval: TpCryptoInterval;
	/** Ascending by `openTime`. Rows upstream sent that could not be read are
	 *  absent rather than zero-filled — the chart plots against a time axis. */
	candles: TpCryptoCandle[];
	attribution: string;
}

/** doc 10 §4's four. Not every one is reachable from a range picker today; the
 *  list is upstream's contract rather than the UI's. */
export const CRYPTO_INTERVALS = ['5m', '15m', '1h', '1d'] as const;
export type TpCryptoInterval = (typeof CRYPTO_INTERVALS)[number];

/**
 * doc 09 §1's range presets, and the interval and depth each one asks for.
 *
 * Here rather than in either half, because it is the contract between them: the
 * endpoint refuses a `limit` that is not one of these, and the detail's range
 * picker must not be able to ask for one. Two copies would drift the first time
 * a range was added — the same reasoning `FX_HISTORY_DAYS` carries.
 *
 * **`limit` is an allowlist, not a bound**, for the reason doc 11 §3 gives
 * about `days`: the response is CDN-cacheable by URL, so a free integer gives
 * 500 distinct edge entries per symbol-and-interval that one client can walk
 * with a loop. Four values give four. It costs the reader nothing, because the
 * detail offers ranges rather than a number field — and a range picker is an
 * allowlist with a nicer name.
 *
 * `MAX` is absent deliberately: it is Week 5's one approved depth cut (doc 23
 * §Week 5).
 */
export const CRYPTO_RANGES = {
	'1D': { interval: '5m', limit: 288 },
	'1W': { interval: '1h', limit: 168 },
	'1M': { interval: '1d', limit: 30 },
	'1Y': { interval: '1d', limit: 365 }
} as const satisfies Record<string, { interval: TpCryptoInterval; limit: number }>;

/* `TpCryptoRange` and the default range land with the detail that picks one.
 * knip is CI-blocking on an export nothing imports, and doc 20 §5 asks for a
 * primitive and its first consumer in one commit rather than a layer at a
 * time. */
