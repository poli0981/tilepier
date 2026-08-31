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
