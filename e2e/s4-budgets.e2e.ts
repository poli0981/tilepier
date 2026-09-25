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

test.describe('S4 · lazy chunk loading', () => {
	test('no heavy library is fetched on first paint', async ({ page }) => {
		const requested: string[] = [];
		page.on('request', (r) => {
			// Our own bundles only. The analytics beacon is a Cloudflare script
			// on every page (doc 16 §3); it is outside doc 20 §6's budgets, and
			// re-fetching it here would pull it off the internet into CI.
			if (r.resourceType() === 'script' && new URL(r.url()).origin === new URL(page.url()).origin) {
				requested.push(r.url());
			}
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

	test('maplibre draws a map: its worker arrives as JS and runs under the CSP', async ({
		page
	}) => {
		// Week 6 spike M0 (doc 22 §S6). This used to assert "maplibre: loaded"
		// — true while the worker MapLibre asks for at runtime was never built,
		// which leaves a blank canvas and a quiet 404. The style is inline and
		// its GeoJSON is tiled by the worker, so `idle` means the worker ran.
		const violations: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
				violations.push(message.text());
			}
		});
		const worker = page.waitForResponse(/maplibre-[\d.]+\/maplibre-gl-worker\.mjs$/);

		await page.goto('/spike/s4');
		await page.getByTestId('load-map').click();
		await expect(page.getByTestId('log')).toContainText(/maplibre [\d.]+: map rendered/, {
			timeout: 15_000
		});

		const response = await worker;
		expect(response.status()).toBe(200);
		// `nosniff` is on (doc 15 §2): a module worker served as anything but
		// JavaScript would be refused, whatever its bytes.
		expect(response.headers()['content-type']).toMatch(/javascript/);

		// Pixels, not a canvas element: the patch is beacon-coloured and the
		// ground near-black, so a drawn frame shows the patch at the centre.
		const colours = await page.evaluate(() => {
			const canvas = document.querySelector<HTMLCanvasElement>('#s4-map canvas');
			const gl = canvas?.getContext('webgl2');
			if (!canvas || !gl) return null;
			const pixel = new Uint8Array(4);
			gl.readPixels(canvas.width >> 1, canvas.height >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
			return [...pixel];
		});
		expect(colours, 'the centre of the map, inside the patch').not.toBeNull();
		expect(colours?.[1] ?? 0, 'green channel of the beacon patch').toBeGreaterThan(150);

		expect(violations).toEqual([]);
	});

	test('dexie loads on demand', async ({ page }) => {
		await page.goto('/spike/s4');

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
		// The assertion that stood here was `HEAVY.test('echarts')`, which is true of
		// the string and could not fail (Week 6 plan, 1a.5). MapLibre is not a
		// bundler chunk any more — its modules are copied whole
		// (scripts/vite-maplibre.ts) — so its loads are named instead. The worker
		// is fetched by the map, not by this page, so it is not in the list yet.
		const vendored = urls
			.filter((u) => /_app\/immutable\/maplibre-[\d.]+\//.test(u))
			.map((u) => u.split('/').at(-1))
			.sort();
		expect(vendored).toEqual(expect.arrayContaining(['maplibre-gl-shared.mjs', 'maplibre-gl.mjs']));
	});
});
