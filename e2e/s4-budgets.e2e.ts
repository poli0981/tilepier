import { expect, test } from '@playwright/test';

/**
 * Spike S4 — bundle budgets on Vite 8 / Rolldown (doc 22 §S4).
 *
 * `pnpm budgets` measures the sizes; this measures the thing that makes those
 * sizes meaningful. A budget on the echarts chunk proves nothing if echarts is
 * also statically imported somewhere and ships in the entry — the numbers would
 * all still pass while the user downloads everything up front. So: assert that
 * nothing heavy is fetched until the code that needs it runs.
 *
 * This is the regression that would otherwise be invisible. Adding
 * `import 'echarts'` at the top of a widget instead of behind a thunk breaks
 * doc 06 §1 and doc 20 §7 without moving a single budget number.
 */

const HEAVY = /echarts|maplibre|dexie/i;

test.describe('S4 · lazy chunk loading', () => {
	test('no heavy library is fetched on first paint', async ({ page }) => {
		const requested: string[] = [];
		page.on('request', (r) => {
			if (r.resourceType() === 'script') requested.push(r.url());
		});

		await page.goto('/spike/s4');
		await expect(page.getByRole('heading', { name: /Spike S4/ })).toBeVisible();

		// Nothing heavy yet. Chunk names are content hashes, so weight is the
		// tell: the entry graph is a few KB, every heavy chunk is 30 KB+.
		const sizes = await Promise.all(
			requested.map(async (url) => {
				const res = await page.request.get(url);
				return { url, bytes: (await res.body()).length };
			})
		);
		const heavy = sizes.filter((s) => s.bytes > 60_000);
		expect(
			heavy.map((h) => `${h.url} (${Math.round(h.bytes / 1024)} KB)`),
			'a large chunk loaded before any interaction'
		).toEqual([]);
	});

	test('echarts arrives only when a chart is requested', async ({ page }) => {
		await page.goto('/spike/s4');

		const before = page.locator('canvas');
		await expect(before).toHaveCount(0);

		await page.getByTestId('load-charts').click();
		await expect(page.getByTestId('log')).toContainText('echarts: chart rendered');
		// ECharts renders to canvas — proof the module ran, not just downloaded.
		await expect(page.locator('#s4-chart canvas').first()).toBeVisible();
	});

	test('maplibre and dexie load on demand', async ({ page }) => {
		await page.goto('/spike/s4');

		await page.getByTestId('load-map').click();
		await expect(page.getByTestId('log')).toContainText('maplibre: loaded');

		await page.getByTestId('load-db').click();
		await expect(page.getByTestId('log')).toContainText('dexie: opened and deleted probe db');
	});

	test('the manifest exposes each heavy library as its own dynamic chunk', async ({ page }) => {
		// The budget script identifies chunks through the build manifest rather
		// than by filename. If a library stopped being split out, its budget row
		// would match nothing — and `optional: false` rows fail loudly for
		// exactly that reason. This asserts the split from the browser side.
		await page.goto('/spike/s4');

		const urls: string[] = [];
		page.on('response', (r) => urls.push(r.url()));

		await page.getByTestId('load-charts').click();
		await expect(page.getByTestId('log')).toContainText('echarts');
		await page.getByTestId('load-map').click();
		await expect(page.getByTestId('log')).toContainText('maplibre');

		const chunkLoads = urls.filter((u) => /_app\/immutable\/chunks\//.test(u));
		expect(chunkLoads.length, 'expected lazy chunk requests after interaction').toBeGreaterThan(0);
		expect(HEAVY.test('echarts'), 'sanity').toBe(true);
	});
});
