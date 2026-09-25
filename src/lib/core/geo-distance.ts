/**
 * Great-circle distance, for the map's "how far from home" (doc 08 §5).
 *
 * Haversine on a sphere of the mean Earth radius: off by up to half a percent
 * against the ellipsoid, which at the distances a saved-places list compares is
 * metres — below what `fmtDistance` prints. No routing: doc 08 §5 leaves
 * directions to the external links.
 */

const EARTH_RADIUS_KM = 6371.0088;

export interface TpPoint {
	lat: number;
	lon: number;
}

export function haversineKm(from: TpPoint, to: TpPoint): number {
	const rad = Math.PI / 180;
	const dLat = (to.lat - from.lat) * rad;
	const dLon = (to.lon - from.lon) * rad;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLon / 2) ** 2;
	// `min` guards the one rounding error that would otherwise make `asin` NaN:
	// two antipodal points can land `a` a hair above 1.
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
