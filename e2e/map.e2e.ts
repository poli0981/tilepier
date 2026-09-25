import { expect, test, type Page } from '@playwright/test';
import { GEOCODE_OK } from '../src/lib/core/__fixtures__/geocode';
import { acceptGate } from './_lib/gate';
import { seedLayout } from './_lib/seed';

/**
 * The map end to end, on the built app under its real CSP (doc 08 §5, doc 15
 * §2): MapLibre from its vendored copy, a worker that has to load as
 * JavaScript, and OpenFreeMap answered by `page.route` — which sees the
 * worker's requests too (doc 22 §S6), and which answers before DNS, since the
 * e2e browser cannot resolve `tiles.openfreemap.org` at all.
 */

/** A style with its data inline: a map draws with no tile request at all. */
const STYLE = {
	version: 8,
	sources: {
		patch: {
			type: 'geojson',
			attribution: '© OpenMapTiles © OpenStreetMap contributors',
			data: {
				type: 'Feature',
				properties: {},
				geometry: {
					type: 'Polygon',
					coordinates: [
						[
							[105.3, 20.3],
							[106.3, 20.3],
							[106.3, 21.3],
							[105.3, 21.3],
							[105.3, 20.3]
						]
					]
				}
			}
		}
	},
	layers: [
		{ id: 'ground', type: 'background', paint: { 'background-color': 'rgb(11, 16, 22)' } },
		{ id: 'patch', type: 'fill', source: 'patch', paint: { 'fill-color': 'rgb(70, 213, 200)' } }
	]
};

/** Answers OpenFreeMap and the geocoder; returns what OpenFreeMap was asked. */
async function stubNetwork(page: Page): Promise<string[]> {
	const asked: string[] = [];
	await page.route('https://tiles.openfreemap.org/**', async (route) => {
		asked.push(route.request().url());
		await route.fulfill({ json: STYLE });
	});
	await page.route('**/api/geocode*', async (route) => {
		await route.fulfill({ json: GEOCODE_OK });
	});
	return asked;
}

function watchCsp(page: Page): string[] {
	const violations: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
			violations.push(message.text());
		}
	});
	return violations;
}

async function seedMap(page: Page, settings: Record<string, unknown>): Promise<void> {
	await acceptGate(page);
	await seedLayout(page, [
		{ instanceId: 'wgt_map', widgetId: 'map', x: 0, y: 0, w: 4, h: 3, settings }
	]);
	await page.reload();
}

test('the tile names OpenFreeMap before asking it anything, then draws home', async ({ page }) => {
	const violations = watchCsp(page);
	const asked = await stubNetwork(page);

	await seedMap(page, {});

	await expect(page.getByTestId('map-notice')).toContainText('OpenFreeMap');
	// The notice is in place *before* the first request, which is what let the
	// map ship without a new legal version (Week 6 plan S1).
	expect(asked).toEqual([]);

	await page.getByTestId('place-search').fill('hà n');
	await page.getByText('Hà Nam').click();

	// The map is up once the tile can be opened from it.
	await expect(page.getByRole('button', { name: 'mở bản đồ' })).toBeVisible({ timeout: 15_000 });
	expect(asked.some((url) => url.includes('/styles/'))).toBe(true);
	expect(violations).toEqual([]);
});

test('the detail saves a place, and the tile counts it', async ({ page }) => {
	const violations = watchCsp(page);
	await stubNetwork(page);

	await seedMap(page, { home: { name: 'Hoàn Kiếm', lat: 21.028511, lon: 105.852401 } });
	await expect(page.getByRole('button', { name: 'mở bản đồ' })).toBeVisible({ timeout: 15_000 });

	await page.getByRole('button', { name: 'mở bản đồ' }).click();
	await expect(page).toHaveURL(/\/w\/map\?i=wgt_map/);
	await expect(page.locator('.tp-mapd [data-testid="map"]')).toHaveAttribute(
		'data-status',
		'ready',
		{
			timeout: 15_000
		}
	);

	await page.getByTestId('place-search').fill('hà n');
	await page.getByText('Hà Nam').click();
	await page.getByTestId('mapd-save').click();
	await expect(page.getByTestId('mapd-saved')).toContainText('Hà Nam');

	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('map-saved-count')).toContainText('1');

	// Across a reload: the place lives in Dexie, not in the page.
	await page.reload();
	await expect(page.getByTestId('map-saved-count')).toContainText('1', { timeout: 15_000 });
	expect(violations).toEqual([]);
});
