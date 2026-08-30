/**
 * The browser side of doc 08 §1's "use my location".
 *
 * Only the *permission* half lands here in the tile commit; asking for a
 * position belongs with the place picker. Kept separate from `service.ts`
 * because that module is pure and node-tested, and this one is nothing but
 * browser API surface.
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
