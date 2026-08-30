import type { TpApiResponse, TpGeocodePayload } from '$lib/api-types';

/**
 * A recorded, trimmed `/api/geocode` envelope (doc 19 §1), the search side of
 * what `__fixtures__/weather.ts` does for the forecast.
 *
 * Two results rather than the endpoint's five, and chosen rather than taken
 * off the top: `Hà Nội` and `Hà Nam` share a prefix, so a fixture built from
 * them catches a picker that renders the wrong row's coordinates — which one
 * unambiguous result never could. The coordinates are already at 2 dp, because
 * that is what the Worker stores (doc 15 §7).
 *
 * `displayName` repeats the name at its head, which is what upstream really
 * does and what `contextOf` exists to trim.
 */

export const GEOCODE_PAYLOAD: TpGeocodePayload = {
	query: 'hà n',
	results: [
		{
			name: 'Hà Nội',
			displayName: 'Hà Nội, Việt Nam',
			lat: 21.03,
			lon: 105.85,
			type: 'city'
		},
		{
			name: 'Hà Nam',
			displayName: 'Hà Nam, Việt Nam',
			lat: 20.54,
			lon: 105.92,
			type: 'state'
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
