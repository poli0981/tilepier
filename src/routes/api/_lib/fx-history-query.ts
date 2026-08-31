/**
 * Query validation for `/api/fx/history` (doc 11 §3).
 *
 * In `_lib` rather than beside the handler, and not by preference: **SvelteKit
 * rejects any non-convention export from a `+server.ts`** — `Invalid export
 * 'parseFxHistoryQuery'` at build time, with `pnpm lint` and `pnpm test` both
 * green because only the build validates it. `geocode-query.ts` and
 * `geohash.ts` are here for the same reason.
 */

/**
 * doc 11 §3 said `days≤365` and doc 23 called it an allowlist; they
 * contradicted each other and the allowlist won (2026-08-31).
 *
 * The response is CDN-cacheable by URL, so a free integer gives 365 distinct
 * edge entries *per pair* that a single client can walk with a loop. Four
 * values give four. It costs the reader nothing, because doc 08 §2's detail
 * offers ranges rather than a number field — and a range picker is an
 * allowlist with a nicer name.
 */
const DAYS = [7, 30, 90, 365] as const;

/** doc 10 §3's worked example, and what the detail opens on. */
const DEFAULT_DAYS = 90;

/** ISO 4217, and the same shape `normalize.ts` keeps in a rate table. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

export interface TpFxHistoryQuery {
	base: string;
	quote: string;
	days: number;
}

export function parseFxHistoryQuery(url: URL): TpFxHistoryQuery | null {
	const pair = url.searchParams.get('pair');
	if (pair === null) return null;

	const [base, quote] = pair.trim().toUpperCase().split('-');
	if (base === undefined || quote === undefined) return null;
	if (!CURRENCY_CODE.test(base) || !CURRENCY_CODE.test(quote)) return null;
	// A pair with itself on both sides is a flat line at 1.0, which can only
	// come from a bug on the calling side. Answering it would hide that.
	if (base === quote) return null;

	const requested = url.searchParams.get('days');
	if (requested === null) return { base, quote, days: DEFAULT_DAYS };

	const days = Number(requested);
	// Out of the list is a bad request rather than a silent clamp — clamping
	// would cache one range's answer under another range's key, which is the
	// reasoning `geocode-query.ts` gives for an unknown `lang`.
	if (!(DAYS as readonly number[]).includes(days)) return null;

	return { base, quote, days };
}
