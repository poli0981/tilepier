import type { TpApiResponse, TpGeocodePayload } from '$lib/api-types';

/**
 * A recorded, trimmed `/api/geocode` envelope (doc 19 §1), the search side of
 * what `__fixtures__/weather.ts` does for the forecast.
 *
 * **Recorded from production on 2026-08-30**, and the shape is the point.
 * Every earlier version of this fixture was tidier than the real answer and
 * hid two defects because of it:
 *
 *  - **Coordinates come back unrounded.** `parseCoords` rounds what a request
 *    carries; `normalizePhoton` passes a geocoder's own answer straight
 *    through. The fixture used to hold 2 dp values, which made a test assert
 *    the opposite of what the endpoint does.
 *  - **Photon answers a road query with one feature per segment**, all sharing
 *    a name and a `displayName`. A search for `Hà Nội` returned one city and
 *    four rows a reader could not tell apart. `dedupeResults` exists for that,
 *    and it needs a fixture that actually contains the duplicates.
 *
 * `Hà Nội` and `Hà Nam` still share a prefix, so a picker that hands back the
 * first row regardless fails on substance rather than passing on shape. And
 * `displayName` repeats the name at its head, which is what `contextOf` trims.
 */

export const GEOCODE_PAYLOAD: TpGeocodePayload = {
	query: 'hà n',
	results: [
		{
			name: 'Hà Nội',
			displayName: 'Hà Nội, Việt Nam',
			lat: 21.0283334,
			lon: 105.854041,
			type: 'city'
		},
		{
			name: 'Hà Nam',
			displayName: 'Hà Nam, Việt Nam',
			lat: 20.5417,
			lon: 105.9229,
			type: 'state'
		},
		// The two that render identically — 25 m apart, and one road.
		{
			name: 'Ring Road 3 Expressway (Hanoi)',
			displayName: 'Ring Road 3 Expressway (Hanoi), Hà Nội, Việt Nam',
			lat: 20.9808057,
			lon: 105.890438,
			type: 'motorway'
		},
		{
			name: 'Ring Road 3 Expressway (Hanoi)',
			displayName: 'Ring Road 3 Expressway (Hanoi), Hà Nội, Việt Nam',
			lat: 20.9810314,
			lon: 105.8903597,
			type: 'motorway'
		}
	],
	attribution: 'Search by Photon/komoot, data © OpenStreetMap contributors (ODbL)'
};

export const GEOCODE_OK: TpApiResponse<TpGeocodePayload> = {
	ok: true,
	data: GEOCODE_PAYLOAD,
	meta: { cachedAt: 1_787_900_000, source: 'photon', stale: false }
};

/** doc 08 §1's "geocode zero-results state" — a real answer, not a failure. */
export const GEOCODE_EMPTY: TpApiResponse<TpGeocodePayload> = {
	ok: true,
	data: { query: 'zzzz', results: [], attribution: GEOCODE_PAYLOAD.attribution },
	meta: { cachedAt: 1_787_900_000, source: 'photon', stale: false }
};
