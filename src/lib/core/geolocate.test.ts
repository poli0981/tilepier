import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserGeoPermission, browserPosition, coarsePosition } from './geolocate';

/**
 * The browser half of "use my location", in the node project with `navigator`
 * stubbed per case — the only way to reach all four permission answers, since
 * a real headless browser auto-denies and would exercise one branch and call it
 * coverage. `coarsePosition`'s rounding is also in `geocode.test.ts`; here it is
 * the default source it falls back to.
 */

afterEach(() => {
	vi.unstubAllGlobals();
});

function geolocation(outcome: GeolocationPosition | GeolocationPositionError) {
	const getCurrentPosition = vi.fn(
		(resolve: PositionCallback, reject: PositionErrorCallback, _options?: PositionOptions) => {
			if ('coords' in outcome) resolve(outcome);
			else reject(outcome);
		}
	);
	return { getCurrentPosition };
}

const FIX = { coords: { latitude: 21.028511, longitude: 105.804817 } } as GeolocationPosition;

describe('browserGeoPermission', () => {
	it('reports what the Permissions API says', async () => {
		for (const state of ['granted', 'denied', 'prompt'] as const) {
			vi.stubGlobal('navigator', {
				geolocation: geolocation(FIX),
				permissions: { query: () => Promise.resolve({ state }) }
			});
			await expect(browserGeoPermission(), state).resolves.toBe(state);
		}
	});

	it('is unsupported, not denied, without a geolocation API', async () => {
		// An insecure context has refused nothing; the tile offers search instead
		// of telling the reader to change a setting that does not exist.
		vi.stubGlobal('navigator', {
			permissions: { query: () => Promise.resolve({ state: 'granted' }) }
		});

		await expect(browserGeoPermission()).resolves.toBe('unsupported');
	});

	it('is unsupported when the query itself is refused, as Safari did for years', async () => {
		vi.stubGlobal('navigator', {
			geolocation: geolocation(FIX),
			permissions: { query: () => Promise.reject(new TypeError('not a permission name')) }
		});

		await expect(browserGeoPermission()).resolves.toBe('unsupported');
	});

	it('is unsupported where there is no navigator at all', async () => {
		vi.stubGlobal('navigator', undefined);

		await expect(browserGeoPermission()).resolves.toBe('unsupported');
	});
});

describe('browserPosition', () => {
	it('asks once, coarsely, and never for the GPS', async () => {
		const api = geolocation(FIX);
		vi.stubGlobal('navigator', { geolocation: api });

		await expect(browserPosition()).resolves.toBe(FIX);
		expect(api.getCurrentPosition.mock.calls[0]?.[2]).toEqual({
			enableHighAccuracy: false,
			timeout: 10_000,
			maximumAge: 60_000
		});
	});

	it('passes a refusal through for the caller to show', async () => {
		const refused = { code: 1, message: 'User denied Geolocation' } as GeolocationPositionError;
		vi.stubGlobal('navigator', { geolocation: geolocation(refused) });

		await expect(browserPosition()).rejects.toBe(refused);
	});

	it('refuses without a geolocation API rather than hanging', async () => {
		vi.stubGlobal('navigator', {});

		await expect(browserPosition()).rejects.toThrow('geolocation unavailable');
	});
});

describe('coarsePosition', () => {
	it('uses the browser by default, and rounds before handing anything out', async () => {
		vi.stubGlobal('navigator', { geolocation: geolocation(FIX) });

		await expect(coarsePosition()).resolves.toEqual({ lat: 21.03, lon: 105.8 });
	});
});
