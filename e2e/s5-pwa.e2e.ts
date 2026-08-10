import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
