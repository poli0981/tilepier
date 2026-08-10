/**
 * Constants shared by client and Worker.
 *
 * This module is the single source of truth for cache TTLs, cache-key spelling,
 * and quota tiers (doc 20 §8). Doc 11 §4 is the authoritative table; the test
 * beside this file asserts the two agree, so drifting one without the other
 * turns CI red rather than producing a silent cache mismatch.
 *
 * Importable from both sides — keep it free of any browser or Worker global.
 */

/* ────────────────────────────────────────────────────────────── legal gate */

/**
 * Bump only for material changes to the legal texts. A stored
 * `tp.legal.v1.acceptedVersion` below this re-gates the app with a
 * "what changed" line (doc 16 §2).
 */
export const LEGAL_VERSION = 1;

/* ─────────────────────────────────────────────────────────────── durations */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* ───────────────────────────────────────────────────────── cache TTL table */

/** One row of doc 11 §4. Both values are milliseconds. */
export interface TpCachePolicy {
	/** Freshness window. Inside it, a stored value is served as fresh. */
	readonly ttlMs: number;
	/**
	 * How long past `ttlMs` a stored value may still be served — but **only**
	 * when upstream fails or the breaker is open, flagged `stale: true`
	 * (doc 11 §4). `null` means the entry never expires.
	 */
	readonly staleMs: number | null;
}

/**
 * Keyed by the key-prefix families in doc 11 §4. KV entries are written with
 * `expirationTtl = (ttlMs + staleMs) / 1000`; freshness is computed from the
 * `cachedAt` stamp inside the value, not from KV expiry.
 */
export const CACHE_POLICY = {
	/** Weather forecast payload. */
	wx: { ttlMs: 600 * SECOND, staleMs: 24 * HOUR },
	/** Air quality — bundled into the wx payload but refreshed on its own clock. */
	aqi: { ttlMs: 1800 * SECOND, staleMs: 24 * HOUR },
	/** Geocoding results. Nominatim's policy *requires* caching (doc 10 §6). */
	geo: { ttlMs: 24 * HOUR, staleMs: 7 * DAY },
	/** FX rate table. Capped further at runtime by upstream `time_next_update`. */
	fx: { ttlMs: 12 * HOUR, staleMs: 48 * HOUR },
	/** Daily FX snapshot. Permanent — this *is* the currency history (doc 10 §3). */
	fxSnap: { ttlMs: Infinity, staleMs: null },
	/** Crypto 24h ticker for a watchlist subset. */
	crTick: { ttlMs: 30 * SECOND, staleMs: 10 * MINUTE },
	/** Crypto klines, sub-hourly intervals. */
	crKlinesIntraday: { ttlMs: 300 * SECOND, staleMs: 6 * HOUR },
	/** Crypto klines, 1h and coarser. */
	crKlinesDaily: { ttlMs: 900 * SECOND, staleMs: 6 * HOUR },
	/** Stock quote (Finnhub). */
	stQuote: { ttlMs: 90 * SECOND, staleMs: 12 * HOUR },
	/** Stock intraday series (Twelve Data). */
	stSeries15min: { ttlMs: 900 * SECOND, staleMs: 24 * HOUR },
	/** Stock daily series (Twelve Data, Stooq fallback). */
	stSeries1day: { ttlMs: 21600 * SECOND, staleMs: 7 * DAY },
	/** RSS feed, per feed URL. */
	rss: { ttlMs: 1200 * SECOND, staleMs: 24 * HOUR }
} as const satisfies Record<string, TpCachePolicy>;

export type TpCacheFamily = keyof typeof CACHE_POLICY;

/* ──────────────────────────────────────────────────────────── cache keys */

/**
 * Key builders. Doc 04 §5 guarantees the client `apiCache` and the Worker KV
 * use the *same* string so debugging correlates 1:1 — which only holds if
 * there is exactly one spelling per payload. Never hand-write a key; call one
 * of these from both sides.
 */
export const cacheKey = {
	weather: (geohash5: string) => `wx:v1:${geohash5}`,
	airQuality: (geohash5: string) => `aqi:v1:${geohash5}`,
	geocode: (lang: string, queryNorm: string) => `geo:v1:${lang}:${queryNorm}`,
	fx: () => `fx:v1:USD`,
	fxSnapshot: (isoDate: string) => `fx:snap:${isoDate}`,
	cryptoTicker: (setHash: string) => `cr:tick:v1:${setHash}`,
	cryptoKlines: (symbol: string, interval: string) => `cr:kl:v1:${symbol}:${interval}`,
	stockQuote: (symbol: string) => `st:q:v1:${symbol}`,
	stockSeries: (symbol: string, interval: '15min' | '1day') => `st:se:v1:${symbol}:${interval}`,
	rss: (urlHash: string) => `rss:v1:${urlHash}`
} as const;

/** Server-side KV keys carry this prefix; the bare key is what the client stores. */
export const KV_PREFIX = 'kv:';

/* ────────────────────────────────────────────────────── Twelve Data quota */

/**
 * Twelve Data free tier: 800 credits/day, resets 00:00 UTC (doc 10 §5).
 * Guard tiers from doc 11 §5 — the counter lives in KV as
 * `st:budget:<utc-date>` and is folded with the upstream `api-credits-left`
 * header, taking the lower of the two signals.
 */
export const STOCK_BUDGET = {
	/** Hard daily ceiling published by the upstream. */
	dailyCredits: 800,
	/** At 90%, stop MISS fetches for intraday series — serve stale or Stooq. */
	intradayStopAt: 720,
	/** Daily series keep going to here, then everything stops until UTC reset. */
	dailySeriesStopAt: 780
} as const;

/* ────────────────────────────────────────────── limits, breaker, upstream */

/** In-Worker soft limiter (doc 11 §7). The zone rule is the real wall. */
export const RATE_LIMIT = {
	/** Requests allowed per bucket, per hashed IP. */
	maxPerBucket: 30,
	/** Bucket width. */
	bucketMs: 10 * SECOND,
	/** How long a bucket counter lives in KV. */
	counterTtlMs: 60 * SECOND
} as const;

/** Per-upstream circuit breaker (doc 11 §6). */
export const BREAKER = {
	/** Consecutive 5xx/timeouts before the breaker opens. */
	failureThreshold: 3,
	/** Cool-down before a half-open probe. Quota trips instead hold to UTC midnight. */
	cooldownMs: 120 * SECOND
} as const;

/** Applied to every upstream fetch from the Worker (doc 11 §8, doc 15 §5). */
export const UPSTREAM = {
	timeoutMs: 8 * SECOND,
	maxResponseBytes: 1024 * 1024,
	/** RSS only: same-scheme redirects, this many hops. */
	maxRedirects: 3
} as const;

/* ─────────────────────────────────────────────────────────── client-side */

/** Exactly one interval drives the whole app (doc 04 §3). */
export const SCHEDULER_TICK_MS = 5 * SECOND;

/** Client fetch backoff on 429 / upstream failure (doc 17 §5). */
export const BACKOFF = {
	baseMs: 1 * SECOND,
	maxMs: 300 * SECOND,
	/** ±20% jitter. */
	jitterRatio: 0.2,
	/** At most one rate-limit toast per this window, however many widgets trip. */
	toastThrottleMs: 60 * SECOND
} as const;

/**
 * Beyond this age a cached payload is not rendered at all, even as stale
 * (`swr()` default, doc 04 §2).
 */
export const HARD_MAX_AGE_MS = 7 * DAY;

/* ────────────────────────────────────────────────────────────── storage */

/** The only three localStorage keys that may exist (doc 05 §2, CLAUDE.md #10). */
export const LOCAL_KEYS = {
	layout: 'tp.layout.v1',
	settings: 'tp.settings.v1',
	legal: 'tp.legal.v1'
} as const;

/** Corrupt JSON is quarantined here rather than crashing the shell (doc 05 §5). */
export const CORRUPT_KEY_PREFIX = 'tp.corrupt.';
