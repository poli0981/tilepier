import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { GEOCODE_EMPTY, GEOCODE_OK } from '$lib/core/__fixtures__/geocode';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpWeatherPlacePicker from './TpWeatherPlacePicker.svelte';
import { SEARCH_DEBOUNCE_MS } from './geocode';
import type { TpPositionSource } from './geolocate';

/**
 * doc 08 §1's place picker — the tile's `empty` state, and the fallback from a
 * refused geolocation permission.
 *
 * Real timers by default: the debounce is the behaviour under test in half
 * these cases, and a clock that is only ever jumped forward would let a passing
 * test coexist with a component that never debounced at all. The one exception
 * is `debounces a run of keystrokes into one request`, which stops the clock on
 * purpose and says why on the spot.
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

/** A row renders its name and its context on two lines. Held as a constant
 *  because a literal newline inside a string is easy to break and hard to
 *  see. */
const NEWLINE = String.fromCharCode(10);

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
	// Insurance only — the one case that fakes the clock restores it in its own
	// `finally`. A file that leaked a stopped clock would hang the next one.
	vi.useRealTimers();
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

		// Read off the rows rather than through `getByText`: a context line can
		// contain another row's name — "Hà Nội, Việt Nam" holds "Hà Nội" — and a
		// text lookup then matches two elements and fails on strict mode rather
		// than on anything about the picker.
		await vi.waitFor(() => {
			const rows = [...document.querySelectorAll("[data-testid='weather-results'] button")];
			// `displayName` repeats the name at its head; the row shows it once.
			expect(rows.map((r) => (r as HTMLElement).innerText.split(NEWLINE))).toEqual([
				['Hà Nội', 'Việt Nam'],
				['Hà Nam', 'Việt Nam'],
				['Ring Road 3 Expressway (Hanoi)', 'Hà Nội, Việt Nam']
			]);
		});
	});

	it('debounces a run of keystrokes into one request', async () => {
		// The one case in this file that stops the clock, because it is the one
		// whose premise is a *gap*: three keystrokes have to land inside a single
		// 400 ms window for "one request" to be the right answer. Real time makes
		// that premise depend on machine load — on 2026-08-31 a full `pnpm
		// test:cov` stretched the interval between two `fill()`s past 400 ms while
		// the browser project's other files ran beside it, two requests genuinely
		// fired, and `expected 1, got 2` was an accurate report about a test that
		// had asked the wrong question. Alone the same file passed every time,
		// which is the signature of a premise the test does not control.
		//
		// So the fills take zero *fake* time however long they really take. Note
		// what is deliberately absent: `shouldAdvanceTime`, the flag the rest of
		// the repo uses. That one keeps the clock running and only lets a test set
		// where it starts — useful when a component wants a plausible `now`, and
		// exactly the wrong tool here, where the whole point is that the clock
		// must not move on its own. `toFake` is narrowed to the debounce's own
		// timer for the same reason: nothing else in this file's path should
		// notice.
		//
		// The window is then crossed in two steps, which asserts *more* than the
		// real-timer version did rather than less. Debouncing is still the
		// behaviour under test — a picker that dropped it fails at 399 ms, and one
		// that kept a token 1 ms debounce (enough to survive a "one request"
		// count) fails there too. That guard is the reason it is worth the
		// ceremony: `geocode.ts` explains at length why search does not go through
		// `swr()`, and this is the only test standing behind that decision.
		const spy = serve(GEOCODE_OK);
		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn() });
		const box = screen.getByTestId('weather-search');

		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		try {
			await box.fill('hà');
			await box.fill('hà n');
			await box.fill('hà nộ');

			vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
			expect(spy).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1);
		} finally {
			// Back to real time before anything waits on the DOM: `expect.element`
			// and `vi.waitFor` retry on a timer, and a stopped one never retries.
			vi.useRealTimers();
		}

		await expect.element(screen.getByTestId('weather-results')).toBeInTheDocument();
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.calls[0]?.[0]).toContain('lang=vi');
	});

	it('hands the chosen row’s own coordinates to the caller, at 2 dp', async () => {
		// Two things at once, and both were wrong on production. The fixture holds
		// two places with a shared prefix, so a picker that passed the first row
		// regardless fails on substance rather than passing on shape — and the
		// coordinates it stores must be rounded, because a geocoder's answer
		// arrives at full precision (doc 08 §1, doc 16 §3).
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

	it('does not offer four rows that render the same', async () => {
		// Production, searching "Hà Nội": one city and four identical "Ring Road 3
		// Expressway (Hanoi)" rows, differing only in coordinates the list does
		// not show. Offering a choice between them is not a choice.
		serve(GEOCODE_OK);
		const screen = render(TpWeatherPlacePicker, { onPick: vi.fn() });

		await screen.getByTestId('weather-search').fill('hà n');
		await expect.element(screen.getByTestId('weather-results')).toBeInTheDocument();

		await vi.waitFor(() => {
			const rows = document.querySelectorAll("[data-testid='weather-results'] button");
			expect(rows).toHaveLength(3);
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
