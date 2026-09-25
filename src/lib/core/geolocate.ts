import { roundCoord } from '$lib/shared-constants';

/**
 * The browser side of doc 08 §1's "use my location" — the permission question
 * and the position itself. Kept separate from `service.ts` because that module
 * is pure and node-tested, and this one is nothing but browser API surface.
 *
 * Not a store, and deliberately not cached: a reader can change this in browser
 * settings while the tab is open, so the tile asks each time it renders the
 * question rather than remembering an answer that may have expired.
 */

/**
 * What the browser will currently allow, without prompting.
 *
 * `'unsupported'` is a distinct answer from `'denied'`: an insecure context or
 * a browser with no Permissions API has not refused anything, and the tile
 * should offer search rather than tell the reader to change a setting that
 * does not exist. Doc 06 §3's `permission-needed` is only the refusal.
 *
 * Injectable so the component test can drive all four answers. In headless
 * Chromium `navigator.geolocation` exists but is auto-denied, so a test that
 * patches nothing would exercise the denied branch alone and call it coverage.
 */
export type TpGeoPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export type TpPermissionSource = () => Promise<TpGeoPermission>;

export const browserGeoPermission: TpPermissionSource = async () => {
	if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
		return 'unsupported';
	}
	// Safari shipped `navigator.permissions` without geolocation support for
	// years and rejects the query rather than returning a state, so the throw is
	// an expected path, not an error worth logging.
	try {
		const status = await navigator.permissions.query({ name: 'geolocation' });
		return status.state;
	} catch {
		return 'unsupported';
	}
};

/* ──────────────────────────────────────────────────────────── the position */

/** All this module ever hands out: two numbers at 2 dp, ~1 km square. */
export interface TpCoarsePosition {
	lat: number;
	lon: number;
}

/** Injectable for the same reason the permission source is: in headless
 *  Chromium the real API exists and is auto-denied, so a test that patches
 *  nothing exercises the failure branch alone and calls it coverage. */
export type TpPositionSource = () => Promise<{ coords: { latitude: number; longitude: number } }>;

/**
 * doc 08 §1: asked on the reader's action, never on load. A one-shot read
 * rather than `watchPosition` — the tile wants a place, not a track — and
 * `enableHighAccuracy` stays off, because two decimal places is a ~1 km cell
 * and turning the GPS on to fill it would cost battery for precision that is
 * discarded a line later.
 */
export const browserPosition: TpPositionSource = () =>
	new Promise((resolve, reject) => {
		if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
			reject(new Error('geolocation unavailable'));
			return;
		}
		navigator.geolocation.getCurrentPosition(resolve, reject, {
			enableHighAccuracy: false,
			timeout: 10_000,
			maximumAge: 60_000
		});
	});

/**
 * The reader's position, **already coarsened**.
 *
 * The rounding happens here, inside the module that receives the fix, and
 * nowhere later — doc 16 §3 and doc 15 §7 require the coordinate to be at 2 dp
 * *before it leaves the device*, and this is the only moment at which a
 * precise one exists at all. Returning the raw fix and rounding at the call
 * site would satisfy every test and violate the invariant, because the Worker
 * re-rounds on arrival and the response is byte-identical either way. That is
 * exactly the shape of a privacy bug that is invisible from the outside.
 */
export async function coarsePosition(
	source: TpPositionSource = browserPosition
): Promise<TpCoarsePosition> {
	const fix = await source();
	return { lat: roundCoord(fix.coords.latitude), lon: roundCoord(fix.coords.longitude) };
}
