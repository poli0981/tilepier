import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { TpApiMeta } from '$lib/api-types';
import { swrCache } from '$lib/core/swr.svelte';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { WEATHER_OK, WEATHER_PAYLOAD } from '$lib/core/__fixtures__/weather';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpWeatherDetail from './TpWeatherDetail.svelte';
import { weatherKey } from './service';

/**
 * doc 08 §1's panel — the states, the attribution, and the chart's summary
 * line. The canvas itself is `charts/TpChart.svelte.test.ts`'s business; what
 * matters here is that the panel feeds it and reads it back out.
 */

const NOW = new Date(Date.UTC(2026, 7, 28, 2, 30));
const HANOI = { name: 'Hà Nội', lat: 21.02, lon: 105.85 };
const FRESH_META: TpApiMeta = { cachedAt: 1_787_900_000, source: 'open-meteo', stale: false };

let db: TpDb;

function props(overrides: Record<string, unknown> = {}) {
	return {
		instanceId: 'wgt_wx',
		settings: { place: HANOI },
		close: vi.fn(),
		db,
		...overrides
	};
}

function serve(body: unknown): ReturnType<typeof vi.fn> {
	const spy = vi.fn(
		async () =>
			new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settings.dispose();
	settings.hydrate();
	swrCache.reset();
	online.reset();
	db = createDb(`tilepier-wxd-${crypto.randomUUID()}`);
});

afterEach(async () => {
	cleanup();
	swrCache.reset();
	online.reset();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
	db.close();
	await db.delete();
});

describe('the panel', () => {
	it('shows the place, the reading and the chart’s summary line', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherDetail, props());

		await expect.element(screen.getByText('Hà Nội')).toBeInTheDocument();
		// doc 13 §8: the chart is always paired with a line somebody can read.
		await expect.element(screen.getByTestId('chart-summary')).toBeVisible();
	});

	it('renders the attribution the payload carries', async () => {
		// doc 10 §8 / doc 16 §5. It rides inside the payload precisely so the UI
		// cannot forget it, which only works if the UI actually prints it.
		serve(WEATHER_OK);
		const screen = render(TpWeatherDetail, props());

		await expect.element(screen.getByTestId('weather-attribution')).toHaveTextContent('Open-Meteo');
	});

	it('draws a row per day in the week strip', async () => {
		serve(WEATHER_OK);
		render(TpWeatherDetail, props());

		// Counted off the document: a testid locator is for one element, and the
		// count is the assertion here.
		await vi.waitFor(() => {
			expect(document.querySelectorAll("[data-testid='weather-day']")).toHaveLength(
				WEATHER_PAYLOAD.daily.length
			);
		});
	});

	it('says to pick a place first when the tile has none', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherDetail, props({ settings: {} }));

		await expect.element(screen.getByTestId('weather-detail-empty')).toBeInTheDocument();
	});

	it('shares the tile’s cache entry rather than opening a second one', async () => {
		// The panel and the tile behind it are the same data key, so opening a
		// detail must not cost a request — `swr` refcounts, and this is the
		// assertion that the panel joined rather than duplicated.
		const spy = serve(WEATHER_OK);
		await db.apiCache.put({
			key: weatherKey(HANOI.lat, HANOI.lon),
			payload: { payload: WEATHER_PAYLOAD, meta: FRESH_META },
			cachedAt: NOW.getTime()
		});

		const screen = render(TpWeatherDetail, props());
		await expect.element(screen.getByTestId('chart-summary')).toBeVisible();

		expect(swrCache.size).toBe(1);
		// Fresh in Dexie and inside the TTL, so nothing should have been fetched.
		expect(spy).not.toHaveBeenCalled();
	});

	it('leaves no cache entry behind when it closes', async () => {
		serve(WEATHER_OK);
		const screen = render(TpWeatherDetail, props());
		await expect.element(screen.getByTestId('chart-summary')).toBeVisible();

		cleanup();
		expect(swrCache.size).toBe(0);
	});

	it('offline with nothing cached says so, and does not blank', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				await Promise.resolve();
				throw new TypeError('Failed to fetch');
			})
		);
		const screen = render(TpWeatherDetail, props());

		await expect.element(screen.getByTestId('weather-detail-offline')).toBeInTheDocument();
	});

	it('names a located place from the live catalogue, not from storage', async () => {
		serve(WEATHER_OK);
		const screen = render(
			TpWeatherDetail,
			props({ settings: { place: { name: '', lat: 21.02, lon: 105.85 } } })
		);

		await expect.element(screen.getByText(m['widget.weather.my_location']())).toBeInTheDocument();
	});
});
