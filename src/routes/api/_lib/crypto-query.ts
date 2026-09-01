import { CRYPTO_INTERVALS, CRYPTO_RANGES, type TpCryptoInterval } from '$lib/api-types';
import { MARKETS_MAX_SYMBOLS, canonicalSymbols, isMarketSymbol } from '$lib/shared-constants';

/**
 * Query validation for `/api/crypto/*` (doc 11 §3, doc 10 §4).
 *
 * In `_lib` rather than beside the handler, and not by preference: **SvelteKit
 * rejects any non-convention export from a `+server.ts`** — `Invalid export
 * 'parseCryptoTickerQuery'` at build time, with `pnpm lint` and `pnpm test`
 * both green because only the build validates it. `geocode-query.ts`,
 * `fx-history-query.ts` and `geohash.ts` are all here for the same reason.
 */

export interface TpCryptoTickerQuery {
	/** In the order the caller asked, so the payload can answer for each. */
	requested: string[];
	/** Sorted and de-duplicated — the `<set>` segment of the cache key. */
	canonical: string[];
}

/**
 * `?symbols=BTCUSDT,ETHUSDT`.
 *
 * Two refusals rather than repairs, both for the reason `fx-history-query.ts`
 * gives about clamping a range: a silent fix files one question's answer under
 * another question's key.
 *
 * - **Over the cap is a refusal, not a truncation.** Thirteen symbols answered
 *   as twelve would cache a partial table under a key that claims the whole
 *   set, and the thirteenth would then be missing from every later read.
 * - **A symbol outside doc 10 §5's allowlist is a refusal, not a drop.**
 *   `canonicalSymbols` drops them — it has to, because it also builds keys from
 *   watchlists read out of storage — so the check has to happen here, before
 *   that, or a typo would quietly shorten the set instead of being reported.
 */
export function parseCryptoTickerQuery(url: URL): TpCryptoTickerQuery | null {
	const raw = url.searchParams.get('symbols');
	if (raw === null) return null;

	const requested = raw
		.split(',')
		.map((part) => part.trim().toUpperCase())
		.filter((part) => part.length > 0);

	if (requested.length === 0 || requested.length > MARKETS_MAX_SYMBOLS) return null;
	if (!requested.every(isMarketSymbol)) return null;

	// De-duplicated for the key, but `requested` keeps its repeats: the caller
	// asked for a list and gets an object keyed by symbol, so a repeat costs
	// nothing and refusing it would be a rule with no reason behind it.
	return { requested, canonical: canonicalSymbols(requested) };
}

/* ─────────────────────────────────────────────────────────────────── klines */

/**
 * The depths a range picker can ask for, derived from `CRYPTO_RANGES` rather
 * than written out again.
 *
 * That derivation is the point: an allowlist of four arbitrary integers would
 * be a rule with no reason behind it, and would drift the first time a range
 * changed. This one *is* the range set, read from the single place both halves
 * import.
 */
const LIMITS = new Set<number>(Object.values(CRYPTO_RANGES).map((range) => range.limit));

export interface TpCryptoKlinesQuery {
	symbol: string;
	interval: TpCryptoInterval;
	/** How many candles to answer with — never how many to fetch. */
	limit: number;
}

/**
 * `?symbol=BTCUSDT&interval=5m&limit=288`.
 *
 * `limit` is an allowlist for the reason `fx-history-query.ts` gives about
 * `days`, and out of it is a `BAD_REQUEST` rather than a silent clamp: clamping
 * files one range's answer under another range's key. The difference from
 * `days` is that here the *cache* key carries no depth at all — doc 11 §4 keys
 * this payload `cr:kl:v1:<sym>:<int>` — so the endpoint fetches one deep series
 * and windows it, and the allowlist is protecting the CDN rather than KV.
 */
export function parseCryptoKlinesQuery(url: URL): TpCryptoKlinesQuery | null {
	const rawSymbol = url.searchParams.get('symbol');
	if (rawSymbol === null) return null;

	const symbol = rawSymbol.trim().toUpperCase();
	if (!isMarketSymbol(symbol)) return null;

	const interval = url.searchParams.get('interval');
	if (interval === null) return null;
	if (!(CRYPTO_INTERVALS as readonly string[]).includes(interval)) return null;

	const rawLimit = url.searchParams.get('limit');
	if (rawLimit === null) return null;
	const limit = Number(rawLimit);
	if (!LIMITS.has(limit)) return null;

	return { symbol, interval: interval as TpCryptoInterval, limit };
}
