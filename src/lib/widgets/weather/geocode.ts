import type { TpGeocodePayload, TpGeocodeResult } from '$lib/api-types';
import { fetchEnvelope } from '$lib/core/api';

/**
 * Place search for the weather tile (doc 08 §1, upstream doc 10 §6).
 *
 * **Deliberately not through `swr()`.** That primitive is built around a data
 * *key* that identifies a thing the deck keeps looking at — one place, one
 * cache row, one scheduler task. A search box is the opposite: a new key per
 * keystroke, each one wanted once and never revalidated. Putting it through
 * `swr` would fill the dedupe map and the Dexie `apiCache` with dead rows for
 * every word the reader typed on the way to the one they meant. The Worker
 * already caches the answers for 24 h (doc 11 §4), which is the caching that
 * matters here.
 *
 * Pure but for the fetch, so the whole contract is node-testable.
 */

/**
 * Mirrors `QUERY_MIN` in `routes/api/_lib/geocode-query.ts`. Duplicated rather
 * than shared: it is a *client* decision not to spend a request, and the server
 * keeps its own guard either way. Asking below it is a `BAD_REQUEST`, which
 * would surface to the reader as an error card for having typed one letter.
 */
export const QUERY_MIN = 2;

/**
 * Long enough that a typed word is one request rather than five, short enough
 * that the list feels attached to the keyboard.
 *
 * The arithmetic that sets the floor: doc 11 §7's in-Worker limiter allows 30
 * requests per 10 s per address. At 400 ms a reader typing continuously spends
 * at most 25 of those, so search alone cannot trip the limiter that the weather
 * refresh also draws on.
 */
export const SEARCH_DEBOUNCE_MS = 400;

/** The reader has typed enough to be asking a question. */
export function isSearchable(raw: string): boolean {
	return raw.trim().length >= QUERY_MIN;
}

export function geocodeUrl(query: string, lang: 'vi' | 'en'): string {
	const params = new URLSearchParams({ q: query.trim(), lang });
	return `/api/geocode?${params.toString()}`;
}

/**
 * Resolves to the matches, or throws a `TpApiError` the caller maps to a state.
 *
 * An empty array is a real answer — doc 08 §1's "geocode zero-results state" —
 * and is not an error.
 */
export async function searchPlaces(
	query: string,
	lang: 'vi' | 'en',
	signal: AbortSignal
): Promise<readonly TpGeocodeResult[]> {
	const result = await fetchEnvelope<TpGeocodePayload>(geocodeUrl(query, lang), signal);
	return result.data.results;
}

/**
 * Drops results a reader could not tell apart.
 *
 * Photon answers a road query with one feature per segment, all carrying the
 * same `name` and the same `displayName` — a search for "Hà Nội" on production
 * returned one city and **four identical "Ring Road 3 Expressway (Hanoi)"
 * rows**, differing only in coordinates the list does not show. Offering a
 * choice between rows that render the same is not a choice.
 *
 * Keyed on what is actually rendered rather than on coordinates: two segments
 * 25 m apart are as indistinguishable to a reader as two at the same point,
 * and the first is as good an answer as any.
 */
export function dedupeResults(results: readonly TpGeocodeResult[]): readonly TpGeocodeResult[] {
	const seen = new Set<string>();
	return results.filter((result) => {
		// A JSON pair rather than a joined string: no separator can appear
		// inside either half, so two rows cannot collide by punctuation.
		const key = JSON.stringify([result.name, contextOf(result)]);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * What to show on a row so two places with the same name can be told apart.
 *
 * Upstream's `displayName` repeats the name at its head far more often than
 * not (`Hà Nội, Việt Nam`), so the name is trimmed off the front rather than
 * printed twice. Returns an empty string when there is nothing left to add,
 * which the row renders as no second line at all.
 */
export function contextOf(result: TpGeocodeResult): string {
	const full = result.displayName.trim();
	const name = result.name.trim();
	if (full === '' || full === name) return '';

	const rest = full.startsWith(`${name},`) ? full.slice(name.length + 1) : full;
	return rest.trim();
}
