/**
 * Geohash, used only for cache keys (`wx:v1:<geohash5>`, doc 04 §5).
 *
 * Five characters is roughly a 5 km cell. That is the point: it collapses
 * everyone in a city onto one cache entry, which is what makes the quota model
 * in doc 11 §5 work, and it coarsens the coordinate before it is ever written
 * anywhere — coordinates are already rounded to 2 dp client-side and again
 * server-side (doc 15 §7), and this rounds them a third time.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(lat: number, lon: number, precision = 5): string {
	let latRange = [-90, 90];
	let lonRange = [-180, 180];
	let hash = '';
	let bits = 0;
	let bit = 0;
	let even = true;

	while (hash.length < precision) {
		const range = even ? lonRange : latRange;
		const mid = (range[0]! + range[1]!) / 2;
		const value = even ? lon : lat;

		if (value >= mid) {
			bits = (bits << 1) + 1;
			range[0] = mid;
		} else {
			bits = bits << 1;
			range[1] = mid;
		}
		if (even) lonRange = range;
		else latRange = range;

		even = !even;
		if (++bit === 5) {
			hash += BASE32[bits];
			bit = 0;
			bits = 0;
		}
	}

	return hash;
}

/** doc 11 §8 / doc 15 §7: enforce the 2 dp rounding server-side too. */
export function roundCoord(value: number): number {
	return Math.round(value * 100) / 100;
}

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
