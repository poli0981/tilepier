/**
 * Query-string coordinate parsing.
 *
 * `geohash` and `roundCoord` used to live here and now live in
 * `$lib/shared-constants` beside `cacheKey`, because doc 04 §5's 1:1 guarantee
 * only means anything once the *client* can spell the key too — and doc 03
 * forbids a widget to import from `routes/api`. This file keeps `parseCoords`,
 * which reads a `URL` and so belongs to request handling rather than to the
 * vocabulary both sides share.
 */

import { roundCoord } from '$lib/shared-constants';

export function parseCoords(url: URL): { lat: number; lon: number } | null {
	const rawLat = url.searchParams.get('lat');
	const rawLon = url.searchParams.get('lon');
	// Presence first: `Number(null)` is 0, so a request with no parameters at
	// all would otherwise be read as a perfectly valid point in the Atlantic.
	if (rawLat === null || rawLon === null || rawLat === '' || rawLon === '') return null;

	const lat = Number(rawLat);
	const lon = Number(rawLon);
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
	if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
	return { lat: roundCoord(lat), lon: roundCoord(lon) };
}
