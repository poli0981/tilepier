import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { GEOCODE_EMPTY, GEOCODE_OK } from '$lib/core/__fixtures__/geocode';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpWeatherPlacePicker from './TpWeatherPlacePicker.svelte';
import type { TpPositionSource } from './geolocate';

/**
 * doc 08 §1's place picker — the tile's `empty` state, and the fallback from a
 * refused geolocation permission.
 *
 * Real timers rather than fake ones: the debounce is the behaviour under test
 * in half these cases, and a fake clock would let a passing test coexist with a
 * component that never debounced at all.
 */

function serve(body: unknown, init: ResponseInit = {}): ReturnType<typeof vi.fn> {
	const spy = vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				...init,
				headers: { 'content-type': 'application/json' }
			})
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

/** The doc 17 §3 heuristic: two consecutive network failures mean offline even
 *  if `navigator.onLine` disagrees. Reached through the store's own API rather
 *  than by writing its private state. */
function goOffline(): void {
	online.noteFetchResult('network-error');
	online.noteFetchResult('network-error');
}

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	settings.patch({ locale: 'vi' });
	online.reset();
});

afterEach(() => {
	cleanup();
	online.reset();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('search', () => {
	it('does not spend a request on one letter', async () => {
		const spy = serve(GEOCODE_OK);
		const onPick = vi.fn();
		const screen = render(TpWeatherPlacePicker, { onPick });

		await screen.getByTestId('weather-search').fill('h');
		// Long enough that a missing gate would have fired: the debounce is 400.
		await new Promise((resolve) => setTimeout(resolve, 700));

		expect(spy).not.toHaveBeenCalled();
	});

	it('lists what came back, with the context line trimmed', async () => {
		serve(GEOCODE_OK);
		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn() });

		await screen.getByTestId('weather-search').fill('hà n');

		await expect.element(screen.getByTestId('weather-results')).toBeInTheDocument();
		await expect.element(screen.getByText('Hà Nội')).toBeInTheDocument();
		await expect.element(screen.getByText('Hà Nam')).toBeInTheDocument();
		// `displayName` is "Hà Nội, Việt Nam"; the name is not printed twice.
		await expect.element(screen.getByText('Việt Nam').first()).toBeInTheDocument();
	});

	it('debounces a run of keystrokes into one request', async () => {
		const spy = serve(GEOCODE_OK);
		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn() });
		const box = screen.getByTestId('weather-search');

		await box.fill('hà');
		await box.fill('hà n');
		await box.fill('hà nộ');

		await expect.element(screen.getByTestId('weather-results')).toBeInTheDocument();
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0]?.[0]).toContain('lang=vi');
	});

	it('hands the chosen row’s own coordinates to the caller', async () => {
		// The reason the fixture holds two places with a shared prefix: a picker
		// that passed the first row regardless would pass this test's shape and
		// fail its substance.
		serve(GEOCODE_OK);
		const onPick = vi.fn();
		const screen = render(TpWeatherPlacePicker, { onPick });

		await screen.getByTestId('weather-search').fill('hà n');
		await expect.element(screen.getByTestId('weather-results')).toBeInTheDocument();
		await screen.getByText('Hà Nam').click();

		await vi.waitFor(() => {
			expect(onPick).toHaveBeenCalledWith({ name: 'Hà Nam', lat: 20.54, lon: 105.92 });
		});
	});

	it('says nothing was found rather than showing an error', async () => {
		serve(GEOCODE_EMPTY);
		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn() });

		await screen.getByTestId('weather-search').fill('zzzz');

		await expect.element(screen.getByTestId('weather-no-results')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-search-error')).not.toBeInTheDocument();
	});

	it('offline: says the search needs the network, and does not try', async () => {
		// doc 17 §3's search-dependent class. A request that fails would report
		// itself as an upstream problem, which is the wrong thing to tell a
		// reader whose wifi is off.
		const spy = serve(GEOCODE_OK);
		goOffline();
		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn() });

		await screen.getByTestId('weather-search').fill('hà n');

		await expect.element(screen.getByTestId('weather-search-offline')).toBeInTheDocument();
		expect(spy).not.toHaveBeenCalled();
	});

	it('error: one line, and no half-rendered list', async () => {
		serve({ ok: false, error: { code: 'UPSTREAM_DOWN' } }, { status: 503 });
		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn() });

		await screen.getByTestId('weather-search').fill('hà n');

		await expect.element(screen.getByTestId('weather-search-error')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-results')).not.toBeInTheDocument();
	});

	it('clearing the box puts the list away', async () => {
		serve(GEOCODE_OK);
		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn() });
		const box = screen.getByTestId('weather-search');

		await box.fill('hà n');
		await expect.element(screen.getByTestId('weather-results')).toBeInTheDocument();

		await box.fill('');
		await expect.element(screen.getByTestId('weather-results')).not.toBeInTheDocument();
	});
});

describe('use my location', () => {
	it('stores a blank name and a 2 dp coordinate', async () => {
		// Blank because there is no reverse-geocode endpoint and a translated
		// name would freeze into the layout at one locale; 2 dp because doc 16 §3
		// requires the coarsening to happen before anything leaves the device.
		serve(GEOCODE_OK);
		const onPick = vi.fn();
		const precise: TpPositionSource = () =>
			Promise.resolve({ coords: { latitude: 21.028511, longitude: 105.804817 } });

		const screen = render(TpWeatherPlacePicker, { onPick, positionSource: precise });
		await screen.getByTestId('weather-locate').click();

		await vi.waitFor(() => {
			expect(onPick).toHaveBeenCalledWith({ name: '', lat: 21.03, lon: 105.8 });
		});
	});

	it('a refusal points at search instead, and picks nothing', async () => {
		serve(GEOCODE_OK);
		const onPick = vi.fn();
		const denied: TpPositionSource = () => Promise.reject(new Error('User denied Geolocation'));

		const screen = render(TpWeatherPlacePicker, { onPick, positionSource: denied });
		await screen.getByTestId('weather-locate').click();

		await expect.element(screen.getByTestId('weather-locate-failed')).toBeInTheDocument();
		expect(onPick).not.toHaveBeenCalled();
		// The box is still there — that is the fallback doc 08 §1 asks for.
		await expect.element(screen.getByTestId('weather-search')).toBeInTheDocument();
	});

	it('is disabled while it is asking, so one gesture is one request', async () => {
		serve(GEOCODE_OK);
		// Held on an object rather than a `let`: TypeScript does not follow an
		// assignment made inside a promise executor, so a bare binding narrows to
		// `null` and the release below stops compiling.
		const gate = { release: () => {} };
		const slow: TpPositionSource = () =>
			new Promise((resolve) => {
				gate.release = () => {
					resolve({ coords: { latitude: 1, longitude: 2 } });
				};
			});

		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn(), positionSource: slow });
		await screen.getByTestId('weather-locate').click();

		await expect.element(screen.getByTestId('weather-locate')).toBeDisabled();
		await expect.element(screen.getByText(m['widget.weather.locating']())).toBeInTheDocument();

		gate.release();
	});
});
