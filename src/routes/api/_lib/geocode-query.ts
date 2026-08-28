/**
 * Query validation for `/api/geocode` (doc 11 §8).
 *
 * In `_lib` rather than beside the handler, and not by preference: **SvelteKit
 * rejects any non-convention export from a `+server.ts`** — `Invalid export
 * 'normalizeQuery'` at build time, with `pnpm lint` and `pnpm test` both green
 * because only the build validates it. `geohash.ts` already puts `parseCoords`
 * here for the same reason; this follows it.
 */

/** doc 10 §6 sends the language upstream, so it is validated rather than
 *  passed through. Not exported: every reader reaches it through
 *  `TpGeocodeQuery`, and knip is CI-blocking on an export nothing imports. */
const LANGS = ['vi', 'en'] as const;
type Lang = (typeof LANGS)[number];

const QUERY_MIN = 2;
const QUERY_MAX = 80;

/**
 * One spelling per query, so `Hà Nội`, ` hà nội ` and `HÀ NỘI` share a cache
 * entry instead of three (doc 04 §5). Diacritics are **kept**: they change the
 * result upstream, so folding them would make two different searches share an
 * answer.
 */
export function normalizeQuery(raw: string): string {
	return raw.trim().toLowerCase().replace(/\s+/g, ' ').normalize('NFC');
}

export interface TpGeocodeQuery {
	q: string;
	qNorm: string;
	lang: Lang;
}

export function parseGeocodeQuery(url: URL): TpGeocodeQuery | null {
	const raw = url.searchParams.get('q');
	if (raw === null) return null;

	const q = raw.trim();
	if (q.length < QUERY_MIN || q.length > QUERY_MAX) return null;

	const requested = url.searchParams.get('lang') ?? 'vi';
	// An unknown language is a bad request rather than a silent default: it
	// would otherwise cache one language's answers under another's key.
	if (!(LANGS as readonly string[]).includes(requested)) return null;

	return { q, qNorm: normalizeQuery(q), lang: requested as Lang };
}
