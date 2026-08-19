import { expect, test } from '@playwright/test';

/**
 * Smoke coverage for the legal gate (doc 16 §2) and the security headers
 * (doc 15 §2). Doc 19 §4's first journey starts here.
 *
 * These assertions exist because the gate has three requirements that pull
 * against each other — present pre-JS, keyed off localStorage, not dismissible
 * by DOM deletion — and the first build got the arrangement exactly backwards,
 * shipping the gate on /legal/* and omitting it from /.
 */

test('gate blocks the deck on first visit', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'TilePier' })).toBeVisible();
});

test('gate markup is in the HTML before any JavaScript runs', async ({ request }) => {
	// Fetching without a browser proves the gate is prerendered, not injected.
	const response = await request.get('/');
	const html = await response.text();
	expect(html).toContain('tp-gate');
});

test('accepting reveals the deck and survives a reload', async ({ page }) => {
	await page.goto('/');
	// Enabled only once hydration has attached the handler — see the gate's
	// `ready` flag. Waiting on it is deterministic; a bare click races.
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();

	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByRole('main')).toBeVisible();

	await page.reload();
	// boot.js should clear the gate before first paint this time.
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByRole('main')).toBeVisible();
});

test('the gate ships both locales and shows one', async ({ page }) => {
	await page.goto('/');

	// doc 14 §6: both halves are in the prerendered markup; CSS on <html lang>
	// picks. display:none also drops the hidden half out of the accessibility
	// tree, which is why the role queries above resolve to exactly one node.
	await expect(page.locator('.tp-gate [data-locale]')).toHaveCount(2);
	await expect(page.locator(".tp-gate [data-locale='vi']")).toBeVisible();
	await expect(page.locator(".tp-gate [data-locale='en']")).toBeHidden();
	await expect(page.getByRole('button', { name: 'Tôi đồng ý' })).toHaveCount(1);
});

test('the ?lang= switch works before hydration and sticks', async ({ page }) => {
	// The switch is a link pair, not a button, precisely so a visitor who cannot
	// read the page can still change it without waiting for JavaScript.
	await page.goto('/?lang=en');

	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('button', { name: 'I agree' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Tôi đồng ý' })).toHaveCount(0);

	// Persisted by the settings store on hydration — boot.js deliberately does
	// not write, or it would store a partial object and quarantine the key.
	// So the persistence has not happened yet at the assertions above: they pass
	// off the prerendered markup alone. Wait for the button to go live before
	// navigating, or this checks that a write which never ran did not stick.
	await expect(page.getByRole('button', { name: 'I agree' })).toBeEnabled();
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('button', { name: 'I agree' })).toBeVisible();
});

test('deleting the gate node does not reveal the deck', async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => document.querySelector('.tp-gate')?.remove());

	// doc 16 §2: "not dismissible by DOM deletion alone".
	await expect(page.getByRole('main')).toBeHidden();
});

test('prose pages are readable without accepting', async ({ page }) => {
	// /about is on this list because doc 13 §11 makes it part of deciding
	// whether to accept, not an afterthought reachable only from inside.
	for (const path of ['/legal/terms', '/legal/privacy', '/legal/licenses', '/about']) {
		await page.goto(path);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByRole('heading').first()).toBeVisible();
	}
});

test('prose pages ship both locales and show one', async ({ page }) => {
	for (const path of ['/legal/terms', '/legal/privacy', '/legal/licenses', '/about']) {
		await page.goto(path);
		// Page content plus the shared back link in TpProse.
		await expect(page.locator("[data-locale='vi']")).toHaveCount(2);
		await expect(page.locator("[data-locale='en']").first()).toBeHidden();
	}
});

test('the gate links to every prose page', async ({ page }) => {
	await page.goto('/');
	const gate = page.locator(".tp-gate [data-locale='vi']");

	for (const path of ['/legal/terms', '/legal/privacy', '/legal/licenses', '/about']) {
		await expect(gate.locator(`a[href$="${path}"]`)).toHaveCount(1);
	}
});

test('security headers are set on HTML responses', async ({ request }) => {
	const response = await request.get('/');
	const headers = response.headers();

	expect(headers['strict-transport-security']).toContain('max-age=31536000');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	expect(headers['cross-origin-opener-policy']).toBe('same-origin');
	expect(headers['permissions-policy']).toContain('geolocation=(self)');

	// Ignored in a <meta> CSP by spec, so it has to arrive as a header.
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");

	// doc 16 §3: no cookies at all.
	expect(headers['set-cookie']).toBeUndefined();
});

test('the CSP carries the hash for SvelteKit inline script', async ({ request }) => {
	// SvelteKit emits the main policy itself (svelte.config.js kit.csp, hash
	// mode) because it must include a hash for its hydration bootstrap. A bare
	// `script-src 'self'` blocks that script, and the only visible symptom is
	// that the page stops responding to clicks — so assert the hash is there.
	const html = await (await request.get('/')).text();
	const meta = /<meta http-equiv="content-security-policy" content="([^"]+)"/.exec(html);

	expect(meta, 'no CSP meta tag emitted').not.toBeNull();
	const policy = meta?.[1] ?? '';
	expect(policy).toContain("default-src 'self'");
	expect(policy).toContain('https://tiles.openfreemap.org');
	expect(policy).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
});

test('no page raises a CSP violation', async ({ page }) => {
	const violations: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) {
			violations.push(msg.text());
		}
	});

	await page.goto('/');
	// Enabled only once hydration has attached the handler — see the gate's
	// `ready` flag. Waiting on it is deterministic; a bare click races.
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await page.goto('/legal/terms');

	expect(violations).toEqual([]);
});
