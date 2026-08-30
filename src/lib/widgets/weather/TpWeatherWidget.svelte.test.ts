import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { scheduler } from '$lib/core/scheduler';
import { swrCache } from '$lib/core/swr.svelte';
import { createDb, type TpDb } from '$lib/core/storage/db';
import type { TpTileSize } from '$lib/core/types';
import type { TpApiMeta } from '$lib/api-types';
import { WEATHER_OK, WEATHER_PAYLOAD, WEATHER_STALE } from '$lib/core/__fixtures__/weather';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpWeatherWidget from './TpWeatherWidget.svelte';
import { weatherKey } from './service';
import type { TpGeoPermission, TpPositionSource } from './geolocate';

/**
 * doc 08 §1's tile and doc 06 §3's states for it — the first widget in the app
 * that talks to the network, so this file is also where the tier-2 wiring gets
 * proved rather than assumed (M4).
 *
 * Three things are held still. The clock, because "now" chooses an hour out of
 * the fixture. `fetch`, because the tile must never reach a real endpoint from
 * a test. And Dexie: every case drives a **throwaway** database through the
 * `db` prop, the way `swr.svelte.test.ts` does, so a cached payload written by
 * one case cannot make the next one pass for the wrong reason.
 *
 * `settings.locale` and Paraglide's locale are separate in a component test
 * (see the note in `TpCalendarWidget.svelte.test.ts`), so message assertions go
 * through `m[...]()` rather than through a literal.
 */

/** 2026-08-28T09:30 in Asia/Ho_Chi_Minh, the fixture's place and first hour. */
const NOW = new Date(Date.UTC(2026, 7, 28, 2, 30));

const HANOI = { name: 'Hà Nội', lat: 21.02, lon: 105.85 };

const M: TpTileSize = { w: 3, h: 2, pxW: 320, pxH: 120, tier: 'M' };
/** 3×3 is tier **M**, not L — tier is L only at `w>=4 || h>=4`. The sparkline
 *  is gated on `h>=3`, which is exactly the distinction that would be lost by
 *  reaching for `size.tier`. */
const TALL: TpTileSize = { w: 3, h: 3, pxW: 320, pxH: 200, tier: 'M' };

/** The `meta` half of a cached reading. Written out rather than read off
 *  `WEATHER_OK`, whose type is the ok-or-error union and does not narrow. */
const FRESH_META: TpApiMeta = { cachedAt: 1_787_900_000, source: 'open-meteo', stale: false };

let db: TpDb;

function props(overrides: Record<string, unknown> = {}) {
	return {
		instanceId: 'wgt_wx',
		settings: { place: HANOI },
		size: M,
		db,
		...overrides
	};
}

/** Resolves every `/api/weather` call with one envelope. */
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

/** A network that is simply not there — doc 17 §4's `TypeError` path. */
function serveNetworkFailure(): ReturnType<typeof vi.fn> {
	const spy = vi.fn(async () => {
		await Promise.resolve();
		throw new TypeError('Failed to fetch');
	});
	vi.stubGlobal('fetch', spy);
	return spy;
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settings.dispose();
	settings.hydrate();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	db = createDb(`tilepier-wx-${crypto.randomUUID()}`);
});

afterEach(async () => {
	cleanup();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
	// Closed before deleted: a live connection makes Dexie log
	// "delete was blocked" and leave the database behind for the next case.
	db.close();
	await db.delete();
});

describe('the reading', () => {
	it('shows the temperature for the hour it is at the place', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props());

		await expect.element(screen.getByTestId('weather-temp')).toHaveTextContent('31°');
		await expect.element(screen.getByTestId('weather-place')).toHaveTextContent('Hà Nội');
	});

	it('names the condition on the glyph, so the icon is not the only channel', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props());

		// Hour 0 of the fixture is WMO 2 — partly cloudy.
		await expect
			.element(screen.getByLabelText(m['widget.weather.wmo_partly_cloudy']()))
			.toBeInTheDocument();
	});

	it('renders an em dash for a gap rather than NaN or a zero', async () => {
		// The fourth fixture hour is the `null` a `NaN` becomes on the wire.
		vi.setSystemTime(new Date(NOW.getTime() + 3 * 3_600_000));
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props());

		const temp = screen.getByTestId('weather-temp');
		await expect.element(temp).toHaveTextContent('—');
	});
});

describe('density (doc 08 §1)', () => {
	it('has no sparkline at h=2', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props({ size: M }));

		await expect.element(screen.getByTestId('weather-temp')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-spark-summary')).not.toBeInTheDocument();
	});

	it('draws one at h=3, which is still tier M', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props({ size: TALL }));

		await expect.element(screen.getByTestId('weather-spark-summary')).toBeInTheDocument();
	});
});

describe('states (doc 06 §3)', () => {
	it('empty: no place is the first-run state, not a failure', async () => {
		const spy = serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props({ settings: {} }));

		await expect.element(screen.getByTestId('weather-empty')).toBeInTheDocument();
		// And it must not fetch. The seeded deck ships this tile empty (doc 13
		// §9), so a request here would be one per reader on first load.
		expect(spy).not.toHaveBeenCalled();
	});

	it('empty: no place registers neither a scheduler task nor a cache entry', () => {
		serve(WEATHER_OK);
		render(TpWeatherWidget, props({ settings: {} }));

		expect(scheduler.size).toBe(0);
		expect(swrCache.size).toBe(0);
	});

	it('loading: a skeleton, never a spinner', async () => {
		// A promise that never settles, so the first frame is the only frame.
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		);
		const screen = render(TpWeatherWidget, props());

		await expect.element(screen.getByLabelText(m['widget.weather.loading']())).toBeInTheDocument();
	});

	it('offline: an offline card when there is nothing cached, not a badge on an empty box', async () => {
		serveNetworkFailure();
		const screen = render(TpWeatherWidget, props());

		await expect.element(screen.getByTestId('weather-offline')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-badge-stale')).not.toBeInTheDocument();
	});

	it('error: one sentence and a retry, and the tile never blanks', async () => {
		serve({ ok: false, error: { code: 'UPSTREAM_DOWN' } }, { status: 503 });
		const screen = render(TpWeatherWidget, props());

		const error = screen.getByTestId('weather-error');
		await expect.element(error).toBeInTheDocument();
		await expect.element(screen.getByText(m['common.retry']())).toBeInTheDocument();
	});

	it('rate-limited: says so rather than showing the generic failure', async () => {
		serve({ ok: false, error: { code: 'RATE_LIMITED', retryAfterS: 30 } }, { status: 429 });
		const screen = render(TpWeatherWidget, props());

		await expect.element(screen.getByText(m['widget.weather.rate_limited']())).toBeInTheDocument();
	});

	it('stale: the Worker’s own stale flag reaches the badge', async () => {
		// The case `T = { payload, meta }` exists for. `swr` would call this
		// `fresh` — it was cached a moment ago — but the Worker served it past
		// its KV TTL because upstream was down (doc 11 §4).
		serve(WEATHER_STALE);
		const screen = render(TpWeatherWidget, props());

		await expect.element(screen.getByTestId('weather-temp')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-badge-stale')).toBeInTheDocument();
	});

	it('ready: a fresh serve carries no badge', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props());

		await expect.element(screen.getByTestId('weather-temp')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-badge-stale')).not.toBeInTheDocument();
	});

	it('permission-needed: only when the reader asked and the browser refused', async () => {
		serve(WEATHER_OK);
		const denied = (): Promise<TpGeoPermission> => Promise.resolve('denied');
		const screen = render(
			TpWeatherWidget,
			props({ settings: { useMyLocation: true }, permissionSource: denied })
		);

		await expect.element(screen.getByTestId('weather-permission')).toBeInTheDocument();
	});

	it('permission-needed: an unsupported browser has refused nothing', async () => {
		// An insecure context or a browser with no Permissions API is not a
		// refusal — search still works, so the tile stays on the empty path.
		serve(WEATHER_OK);
		const unsupported = (): Promise<TpGeoPermission> => Promise.resolve('unsupported');
		const screen = render(
			TpWeatherWidget,
			props({ settings: { useMyLocation: true }, permissionSource: unsupported })
		);

		await expect.element(screen.getByTestId('weather-empty')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-permission')).not.toBeInTheDocument();
	});
});

describe('picking a place (doc 06 §2)', () => {
	it('hands the choice to the host rather than writing storage itself', async () => {
		// doc 06 §2's round trip: the widget owns none of it. The deck store
		// writes `tp.layout.v1`, `TpGrid.updateTile` pushes the new record back
		// in, and the tile re-reads it — which is the contract a Week 2 bug broke
		// by freezing the tile's props at mount (doc 06 §5 rule 11).
		serve(WEATHER_OK);
		const onUpdateSettings = vi.fn();
		const at: TpPositionSource = () =>
			Promise.resolve({ coords: { latitude: 21.028511, longitude: 105.804817 } });

		const screen = render(
			TpWeatherWidget,
			props({ settings: {}, onUpdateSettings, positionSource: at })
		);

		await expect.element(screen.getByTestId('weather-empty')).toBeInTheDocument();
		await screen.getByTestId('weather-locate').click();

		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({
				place: { name: '', lat: 21.03, lon: 105.8 },
				useMyLocation: true
			});
		});
	});

	it('the denied card still offers search', async () => {
		// doc 08 §1: a permission card that only reports the refusal leaves the
		// reader at a dead end the tile can perfectly well get out of.
		serve(WEATHER_OK);
		const denied = (): Promise<TpGeoPermission> => Promise.resolve('denied');
		const screen = render(
			TpWeatherWidget,
			props({ settings: { useMyLocation: true }, permissionSource: denied })
		);

		await expect.element(screen.getByTestId('weather-permission')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-search')).toBeInTheDocument();
	});

	it('a stored place labels itself, and a located one is named live', async () => {
		// A blank name is what geolocation stores — there is no reverse-geocode
		// endpoint, and a translated string frozen into the layout would be wrong
		// the moment the reader switched locale.
		serve(WEATHER_OK);
		const screen = render(
			TpWeatherWidget,
			props({ settings: { place: { name: '', lat: 21.02, lon: 105.85 } } })
		);

		await expect
			.element(screen.getByTestId('weather-place'))
			.toHaveTextContent(m['widget.weather.my_location']());
	});
});

describe('the scheduler and cache wiring (doc 04 §3)', () => {
	it('registers one interval task under the DATA KEY, not the instanceId', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props());
		await expect.element(screen.getByTestId('weather-temp')).toBeInTheDocument();

		const tasks = scheduler.inspect();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.id).toBe(weatherKey(HANOI.lat, HANOI.lon));
		expect(tasks[0]?.id).not.toBe('wgt_wx');
		expect(tasks[0]?.cadence).toEqual({ kind: 'interval', everyMs: 600_000 });
	});

	it('two tiles on one place share a task, a cache entry and a request', async () => {
		const spy = serve(WEATHER_OK);
		render(TpWeatherWidget, props({ instanceId: 'wgt_a' }));
		render(
			TpWeatherWidget,
			// A different coordinate inside the same ~5 km geohash cell: the same
			// place as far as the cache is concerned, which is the whole point.
			props({ instanceId: 'wgt_b', settings: { place: { ...HANOI, lat: 21.01, lon: 105.86 } } })
		);

		// Both render into one document, so a testid locator is ambiguous by
		// design here; counting is the assertion anyway.
		await vi.waitFor(() => {
			expect(document.querySelectorAll("[data-testid='weather-temp']")).toHaveLength(2);
		});

		expect(scheduler.size).toBe(1);
		expect(swrCache.size).toBe(1);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('leaves nothing behind on unmount', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props());
		await expect.element(screen.getByTestId('weather-temp')).toBeInTheDocument();

		cleanup();

		expect(scheduler.size).toBe(0);
		expect(swrCache.size).toBe(0);
	});

	it('follows the place to a new key instead of stranding the old one', async () => {
		// The trap `{#key dataKey}` exists for. `useRefresh` snapshots its id at
		// mount and `TpGrid.updateTile` swaps props without remounting, so a tile
		// wired the obvious way keeps refreshing a place the reader has left —
		// and never refreshes the one on screen. Nothing about it fails loudly.
		serve(WEATHER_OK);
		const screen = render(TpWeatherWidget, props());
		await expect.element(screen.getByTestId('weather-temp')).toBeInTheDocument();
		expect(scheduler.inspect()[0]?.id).toBe(weatherKey(HANOI.lat, HANOI.lon));

		const paris = { name: 'Paris', lat: 48.86, lon: 2.35 };
		await screen.rerender(props({ settings: { place: paris } }));

		await vi.waitFor(() => {
			const tasks = scheduler.inspect();
			expect(tasks).toHaveLength(1);
			expect(tasks[0]?.id).toBe(weatherKey(paris.lat, paris.lon));
		});
		expect(swrCache.size).toBe(1);
	});
});

describe('the cache (doc 04 §2)', () => {
	it('renders the last payload from Dexie before the network answers', async () => {
		// doc 04 §2.1: hydrate first, revalidate after — a tile shows last-good
		// data in its first frame rather than a skeleton over something already
		// on the device.
		await db.apiCache.put({
			key: weatherKey(HANOI.lat, HANOI.lon),
			payload: { payload: WEATHER_PAYLOAD, meta: FRESH_META },
			cachedAt: NOW.getTime()
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		);

		const screen = render(TpWeatherWidget, props());
		await expect.element(screen.getByTestId('weather-temp')).toHaveTextContent('31°');
	});

	it('degrades to a stale badge over real data when the network is gone', async () => {
		// doc 17 §3's cached-data contract: last payload plus a badge, not a
		// blank tile and not an offline card.
		await db.apiCache.put({
			key: weatherKey(HANOI.lat, HANOI.lon),
			payload: { payload: WEATHER_PAYLOAD, meta: FRESH_META },
			// Older than the 600 s client TTL, so it revalidates and fails.
			cachedAt: NOW.getTime() - 20 * 60_000
		});
		serveNetworkFailure();

		const screen = render(TpWeatherWidget, props());
		await expect.element(screen.getByTestId('weather-temp')).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-badge-offline')).toBeInTheDocument();
	});
});
