import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptGate } from './_lib/gate';

/**
 * Spike S5 — vite-plugin-pwa × adapter-cloudflare (doc 22 §S5).
 *
 * Pass criteria, one test each: `/offline` served when offline; hashed assets
 * cache-first; `/api/*` bypassed; the update flow waits for the user.
 *
 * Service workers need a secure context, which is why the harness serves over
 * https (see playwright.config.ts).
 */

/**
 * Waits for the service worker to be active.
 *
 * `expect.poll`, not `page.waitForFunction`: an async predicate handed to
 * waitForFunction evaluates to a Promise, which is always truthy, so the wait
 * returns immediately and the assertion that follows fails against a worker
 * that has not registered yet. Costly minutes were spent on that.
 */
async function awaitServiceWorker(page: import('@playwright/test').Page) {
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const reg = await navigator.serviceWorker.getRegistration();
					return Boolean(reg?.active);
				}),
			{ timeout: 20_000, message: 'service worker never became active' }
		)
		.toBe(true);
}

/**
 * Waits until the precache is populated.
 *
 * "The worker is active" and "the worker has finished precaching 47 entries"
 * are different moments, and a fixed sleep between them is a flake waiting to
 * happen on a slower machine.
 */
async function awaitPrecache(page: import('@playwright/test').Page) {
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					let count = 0;
					for (const name of await caches.keys()) {
						const cache = await caches.open(name);
						count += (await cache.keys()).length;
					}
					return count;
				}),
			{ timeout: 20_000, message: 'precache never filled' }
		)
		.toBeGreaterThan(20);
}

test.describe('S5 · PWA on adapter-cloudflare', () => {
	test('the service worker registers and activates', async ({ page }) => {
		await page.goto('/');
		await awaitServiceWorker(page);

		const scope = await page.evaluate(async () => {
			const reg = await navigator.serviceWorker.getRegistration();
			return reg?.scope ?? null;
		});
		expect(scope).toContain('localhost');
	});

	test('offline navigation falls back to /offline', async ({ page, context }) => {
		await page.goto('/');
		await awaitServiceWorker(page);

		await awaitPrecache(page);
		await context.setOffline(true);

		// A route that was never visited, so only the SW fallback can answer it.
		await page.goto('/never-visited-route-9f2k').catch(() => {});
		await expect(page.getByRole('heading', { name: 'ngoại tuyến' })).toBeVisible();

		await context.setOffline(false);
	});

	test('the precached shell still renders offline', async ({ page, context }) => {
		await page.goto('/legal/terms');
		await awaitServiceWorker(page);
		await awaitPrecache(page);

		await context.setOffline(true);
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Điều khoản' })).toBeVisible();

		await context.setOffline(false);
	});

	test('/api/* is never served from a cache', async ({ page }) => {
		await page.goto('/');
		await awaitServiceWorker(page);

		// doc 17 §2: the client already keeps a Dexie apiCache; double-caching
		// creates staleness nobody can reason about. Assert no cache entry for
		// an /api/ URL exists after the SW has had a chance to see one.
		await page.evaluate(() => fetch('/api/_probe').catch(() => {}));
		await page.waitForTimeout(500);

		const cachedApiUrls = await page.evaluate(async () => {
			const names = await caches.keys();
			const found: string[] = [];
			for (const name of names) {
				const cache = await caches.open(name);
				for (const req of await cache.keys()) {
					if (new URL(req.url).pathname.startsWith('/api/')) found.push(req.url);
				}
			}
			return found;
		});

		expect(cachedApiUrls, 'an /api/ response was cached by the service worker').toEqual([]);
	});

	test('hashed immutable assets are cached', async ({ page }) => {
		await page.goto('/');
		await awaitServiceWorker(page);
		await awaitPrecache(page);

		const immutableCached = await page.evaluate(async () => {
			const names = await caches.keys();
			let count = 0;
			for (const name of names) {
				const cache = await caches.open(name);
				for (const req of await cache.keys()) {
					if (new URL(req.url).pathname.startsWith('/_app/immutable/')) count += 1;
				}
			}
			return count;
		});

		expect(immutableCached).toBeGreaterThan(0);
	});

	test('hashed output the Vite manifest cannot list is cached on first use', async ({ page }) => {
		// doc 17 §2 (2026-09-29). `$service-worker`'s `build` list comes from the
		// Vite client manifest, and two kinds of output never appear in it: the
		// MapLibre modules scripts/vite-maplibre.ts copies in, and the tag worker
		// Vite builds on its own. Neither was precached nor cached on use, so a
		// first map or a first library scan with no connection failed even after
		// the reader had used both online.
		const immutable = join(process.cwd(), '.svelte-kit', 'cloudflare', '_app', 'immutable');
		const maplibre = readdirSync(immutable).find((name) => name.startsWith('maplibre-'));
		const worker = readdirSync(join(immutable, 'workers')).find((name) =>
			name.startsWith('tag-worker-')
		);
		expect(maplibre, 'the build carries no MapLibre modules').toBeDefined();
		expect(worker, 'the build carries no tag worker').toBeDefined();
		const paths = [
			`/_app/immutable/${maplibre}/maplibre-gl-worker.mjs`,
			`/_app/immutable/workers/${worker}`
		];

		await page.goto('/');
		await awaitServiceWorker(page);
		await expect
			.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
			.toBe(true);

		await page.evaluate(async (urls) => {
			for (const url of urls) await (await fetch(url)).arrayBuffer();
		}, paths);

		for (const path of paths) {
			await expect
				.poll(() => page.evaluate(async (url) => (await caches.match(url)) !== undefined, path), {
					timeout: 5_000,
					message: `${path} was not cached on use`
				})
				.toBe(true);
		}
	});
});

/**
 * The Week 8 PWA pass (doc 17 §2): the shell is precached, what a reader uses
 * is kept as it is used, and the details of the widgets on their deck are
 * fetched while they are idle.
 */
test.describe('the shell, and what the reader uses', () => {
	/** Source module → emitted file, from the client build's Vite manifest. */
	const manifest = JSON.parse(
		readFileSync(
			join(process.cwd(), '.svelte-kit', 'output', 'client', '.vite', 'manifest.json'),
			'utf8'
		)
	) as Record<string, { file: string }>;

	function chunk(source: string): string {
		const entry = manifest[source];
		if (entry === undefined) throw new Error(`${source} is not in the client manifest`);
		return `/_app/immutable/${entry.file.replace(/^_app\/immutable\//, '')}`;
	}

	const WIDGET_CHUNKS = Object.keys(manifest)
		.filter((source) => /^src\/lib\/widgets\/[^/]+\/Tp\w+(Widget|Detail)\.svelte$/.test(source))
		.map(chunk);

	async function cachedPaths(page: Page): Promise<string[]> {
		return page.evaluate(async () => {
			const found: string[] = [];
			for (const name of await caches.keys()) {
				for (const request of await (await caches.open(name)).keys()) {
					found.push(new URL(request.url).pathname);
				}
			}
			return found;
		});
	}

	test('an install precaches the shell and no widget at all', async ({ page }) => {
		// Before Week 8 the precache was every file in the build: all fifteen
		// tiles and details and ECharts, for every visitor, on the first visit.
		// The gate is left up, so no deck mounts and nothing beyond the shell
		// is used.
		expect(WIDGET_CHUNKS.length).toBe(30);
		await page.goto('/');
		await awaitServiceWorker(page);
		await awaitPrecache(page);

		const cached = new Set(await cachedPaths(page));
		expect(WIDGET_CHUNKS.filter((path) => cached.has(path))).toEqual([]);
		expect(cached.has(chunk('src/lib/charts/echarts.ts'))).toBe(false);
		// …while the pages and their own preloads are all there.
		for (const page of ['/', '/offline', '/settings']) expect(cached.has(page), page).toBe(true);
	});

	test('a detail never opened opens with no connection', async ({ page, context }) => {
		await acceptGate(page, { dismissCoach: true });
		await expect(page.locator('.grid-stack-item').first()).toBeVisible();
		await awaitServiceWorker(page);

		// core/warm.ts fetches the deck's details once a worker controls the
		// page and the reader is idle; the worker keeps what it fetched.
		const detail = chunk('src/lib/widgets/calendar/TpCalendarDetail.svelte');
		await expect
			.poll(async () => (await cachedPaths(page)).includes(detail), {
				timeout: 20_000,
				message: 'the calendar detail was never kept'
			})
			.toBe(true);

		// And everything this first visit loaded before the worker was in
		// control — the grid, the tiles — has been handed over (KEEP). Going
		// offline before that finishes was the first draft's race.
		await expect
			.poll(
				() =>
					page.evaluate(async () => {
						const kept = new Set<string>();
						for (const name of await caches.keys()) {
							for (const request of await (await caches.open(name)).keys()) {
								kept.add(new URL(request.url).pathname);
							}
						}
						return performance
							.getEntriesByType('resource')
							.map((entry) => new URL(entry.name).pathname)
							.filter((path) => path.startsWith('/_app/immutable/') && !kept.has(path));
					}),
				{ timeout: 20_000, message: 'something the page loaded was never kept' }
			)
			.toEqual([]);

		// Only the worker's cache may answer from here: the browser's own HTTP
		// cache would otherwise serve the chunk and prove nothing.
		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.clearBrowserCache');
		await context.setOffline(true);
		await page.reload();
		await expect(page.locator('.grid-stack-item').first()).toBeVisible();

		// The calendar tile is the one holding a table (as journey-4 finds it).
		await page
			.locator('.grid-stack-item')
			.filter({ has: page.locator('table') })
			.first()
			.getByRole('button', { name: 'mở chi tiết' })
			.click();
		await expect(page.getByTestId('event-title')).toBeVisible();

		await context.setOffline(false);
	});

	test('a widget never loaded, added with no connection, says so', async ({ page, context }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await acceptGate(page, { dismissCoach: true });
		await expect(page.locator('.grid-stack-item').first()).toBeVisible();
		await awaitServiceWorker(page);

		const cdp = await context.newCDPSession(page);
		await cdp.send('Network.clearBrowserCache');
		await context.setOffline(true);

		// The calculator is not on the seeded deck, so its chunk was never
		// fetched; the drawer still offers it.
		await page.getByTestId('open-drawer').click();
		await page.getByTestId('add-calc').click();
		await expect(page.getByTestId('widget-unavailable')).toBeVisible();
		expect(errors).toEqual([]);

		await context.setOffline(false);
	});

	test('activating a new worker deletes every older cache', async ({ page }) => {
		await page.addInitScript(() => {
			void caches.open('tp-cache-from-an-older-deploy');
		});
		await page.goto('/');
		await awaitServiceWorker(page);
		await expect
			.poll(() => page.evaluate(async () => (await caches.keys()).join(',')))
			.not.toContain('from-an-older-deploy');
	});

	test('the app is installable', async ({ page, context }) => {
		await page.goto('/');
		await awaitServiceWorker(page);
		const cdp = await context.newCDPSession(page);
		const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
			installabilityErrors: { errorId: string }[];
		};
		expect(installabilityErrors.map((error) => error.errorId)).toEqual([]);
	});
});

test.describe('S5 · the hand-rolled service worker', () => {
	const sw = readFileSync(
		join(process.cwd(), '.svelte-kit', 'cloudflare', 'service-worker.js'),
		'utf8'
	);

	test('skipWaiting is reachable only through a user-triggered message', () => {
		// doc 17 §2: "skipWaiting only on user action; never reload under the
		// user". The install handler must not call it.
		const index = sw.indexOf('skipWaiting');
		expect(index, 'no skipWaiting call found').toBeGreaterThan(-1);
		const preceding = sw.slice(Math.max(0, index - 200), index);
		expect(preceding, 'skipWaiting is not guarded by a SKIP_WAITING message').toContain(
			'SKIP_WAITING'
		);
	});

	test('/api/* is excluded at the source, not just by convention', () => {
		expect(sw).toContain('/api/');
	});

	test('the web manifest declares both icon purposes', () => {
		const manifest = JSON.parse(
			readFileSync(join(process.cwd(), '.svelte-kit', 'cloudflare', 'manifest.webmanifest'), 'utf8')
		);
		expect(manifest.name).toBe('TilePier');
		expect(manifest.display).toBe('standalone');
		const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose);
		expect(purposes).toContain('maskable');
	});
});

/**
 * doc 17 §2's install icons, fetched rather than read.
 *
 * The test above only read the manifest's JSON, so it passed for months while
 * both icons pointed at a `/favicon.svg` that answered with the 404 page
 * (2026-09-29, Brave's console). Every icon the manifest or the head names is
 * now requested, and a PNG must be the size its entry claims.
 */
test.describe('the icons (doc 12 §5, doc 17 §2)', () => {
	interface TpIcon {
		src: string;
		sizes: string;
		type: string;
		purpose?: string;
	}

	/** Width and height from a PNG's IHDR chunk. */
	function pngSize(bytes: Buffer): string {
		return `${String(bytes.readUInt32BE(16))}x${String(bytes.readUInt32BE(20))}`;
	}

	test('every manifest icon is an image of the size it claims', async ({ request }) => {
		const manifest = (await (await request.get('/manifest.webmanifest')).json()) as {
			icons: TpIcon[];
		};

		for (const icon of manifest.icons) {
			const response = await request.get(icon.src);
			expect(response.status(), icon.src).toBe(200);
			expect(response.headers()['content-type'], icon.src).toMatch(/^image\//);
			if (icon.type === 'image/png') {
				expect(pngSize(await response.body()), icon.src).toBe(icon.sizes);
			}
		}

		const any = manifest.icons.filter((icon) => (icon.purpose ?? 'any').includes('any'));
		expect(any.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
		expect(manifest.icons.some((icon) => icon.purpose?.includes('maskable'))).toBe(true);
	});

	test('every icon the page links to is an image', async ({ page, request }) => {
		await page.goto('/');
		const hrefs = await page
			.locator('link[rel~="icon"], link[rel="apple-touch-icon"]')
			.evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

		expect(hrefs.length).toBeGreaterThanOrEqual(3);
		for (const href of hrefs) {
			const response = await request.get(href);
			expect(response.status(), href).toBe(200);
			expect(response.headers()['content-type'], href).toMatch(/^image\//);
		}
	});
});
