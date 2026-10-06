import { expect, test, type APIRequestContext } from '@playwright/test';
import { SECURITY_HEADERS } from '../src/lib/server/security-headers';
import { seedLayout } from './_lib/seed';

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

// doc 16 §2: "the app store hydrates only after acceptance flag exists — the
// gate is a real gate in code, not an overlay". Until Week 5b it was an overlay:
// the deck mounted under the hidden `.tp-app`, and a networked tile was free to
// call /api/* before the visitor had agreed to anything. A currency tile is the
// probe because it needs no permission to fetch; the seeded deck's weather
// tile waits for geolocation, so it would have hidden the fault.
test('nothing mounts and nothing is fetched until the gate is accepted', async ({ page }) => {
	await seedLayout(page, [
		{
			instanceId: 'wgt_fx',
			widgetId: 'currency',
			x: 0,
			y: 0,
			w: 3,
			h: 2,
			settings: { base: 'USD', quote: 'VND', amount: 1 }
		}
	]);
	const api: string[] = [];
	page.on('request', (request) => {
		const { pathname } = new URL(request.url());
		if (pathname.startsWith('/api/')) api.push(pathname);
	});
	await page.route('**/api/**', (route) =>
		route.fulfill({ status: 503, json: { ok: false, error: { code: 'UPSTREAM_DOWN' } } })
	);

	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await page.waitForLoadState('networkidle');

	expect(await page.locator('.grid-stack-item').count()).toBe(0);
	expect(api).toEqual([]);

	await accept.click();
	await expect(page.locator('.grid-stack-item')).toHaveCount(1);
	await expect.poll(() => api).toContain('/api/fx');
});

// doc 16 §2: bumping LEGAL_VERSION re-gates everyone "with a 'what changed'
// line". The line existed in the doc since Week 1 and in no code until
// LEGAL_VERSION 2 made it matter — and a reader who agreed to "no analytics"
// has to be told, before paint, not left to find it on a page they already read.
test('a reader who agreed to an older version sees the gate again, with what changed', async ({
	page
}) => {
	await page.addInitScript(() => {
		if (sessionStorage.getItem('tp.e2e.legal-v1') !== null) return;
		sessionStorage.setItem('tp.e2e.legal-v1', '1');
		localStorage.setItem(
			'tp.legal.v1',
			JSON.stringify({ acceptedVersion: 1, acceptedAt: '2026-09-01T00:00:00Z' })
		);
	});

	await page.goto('/');
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.locator("[data-locale='vi'] [data-testid='gate-changed']")).toBeVisible();

	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('dialog')).toBeHidden();

	await page.reload();
	await expect(page.getByRole('dialog')).toBeHidden();
	expect(
		await page.evaluate(() => JSON.parse(localStorage.getItem('tp.legal.v1') ?? '{}'))
	).toMatchObject({ acceptedVersion: 3 });
});

// LEGAL_VERSION 3: the cookie a version 2 reader was told did not exist. They
// are asked again, and the one "what changed" line names it.
test('a reader who agreed to version 2 is told about the cookie', async ({ page }) => {
	await page.addInitScript(() => {
		if (sessionStorage.getItem('tp.e2e.legal-v2') !== null) return;
		sessionStorage.setItem('tp.e2e.legal-v2', '1');
		localStorage.setItem(
			'tp.legal.v1',
			JSON.stringify({ acceptedVersion: 2, acceptedAt: '2026-09-24T00:00:00Z' })
		);
	});

	await page.goto('/');

	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.locator("[data-locale='vi'] [data-testid='gate-changed']")).toContainText(
		'cf_clearance'
	);
});

test('a first visit sees no "what changed" line — there is nothing it changed from', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.locator("[data-locale='vi'] [data-testid='gate-changed']")).toBeHidden();
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

test('the licences page carries every licence that ships, and runs no script (doc 16 §5)', async ({
	page
}) => {
	const scripts: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (path.startsWith('/_app/') && path.endsWith('.js')) scripts.push(path);
	});
	await page.goto('/legal/licenses');

	// The devDependencies whose code ships, which `pnpm licenses list --prod`
	// cannot see — the reason licenses:gen reads the build's module graph.
	const appendix = page.getByTestId('licence-appendix');
	for (const name of ['@sveltejs/kit', 'devalue', 'set-cookie-parser', 'worktop']) {
		await expect(appendix.locator('summary', { hasText: name }).first()).toBeAttached();
	}
	// The register's sources are links now.
	await expect(page.locator("[data-locale='vi'] a[href='https://open-meteo.com/']")).toHaveCount(1);

	// `csr = false`: the text stays HTML, and the page loads no app script.
	expect(scripts).toEqual([]);
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

	// Every one, value for value — Permissions-Policy was only checked for a
	// substring until Week 8. HSTS matches the zone's own in production, which
	// replaces this header at the edge (doc 15 §2), `preload` included — so
	// what this suite sees is what readers get.
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		expect(headers[name], name).toBe(value);
	}

	// Ignored in a <meta> CSP by spec, so it has to arrive as a header — and
	// *only* it: a second full policy here would be enforced alongside the
	// meta one without SvelteKit's hash, and block hydration (see _headers).
	expect(headers['content-security-policy']).toBe("frame-ancestors 'none'");

	// doc 16 §3: the app itself sets no cookie. The one cookie on the site,
	// Cloudflare's cf_clearance, comes from the edge after a passed bot check
	// (LEGAL_VERSION 3), never from a response of the app.
	expect(headers['set-cookie']).toBeUndefined();
});

test('a page the Worker renders carries the same headers as a prerendered one', async ({
	request
}) => {
	// `/` above comes from the ASSETS binding with `_headers`; a 404 is rendered
	// by the Worker, where the hook sets the same list (doc 15 §2). Nothing
	// held the two paths together but a comment until Week 8.
	const response = await request.get('/no-such-page');
	expect(response.status()).toBe(404);
	expect(response.headers()['content-type']).toContain('text/html');
	const headers = response.headers();

	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		expect(headers[name], name).toBe(value);
	}

	// Rendered rather than prerendered, SvelteKit sends its policy as a header
	// instead of a <meta>, and a header can carry frame-ancestors itself.
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	expect(headers['content-security-policy']).toContain("default-src 'self'");
	expect(headers['set-cookie']).toBeUndefined();
});

test('security.txt is served where RFC 9116 puts it', async ({ request }) => {
	// A dot-directory under static/ has to survive the build and the asset
	// upload both; `security-txt.test.ts` checks what the file says.
	const response = await request.get('/.well-known/security.txt');

	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toMatch(/^text\/plain/);
	expect(await response.text()).toContain(
		'Contact: https://github.com/poli0981/tilepier/security/advisories/new'
	);
});

/** The page's `<meta>` CSP as directive → sorted values. SvelteKit appends its
 *  hashes after the configured sources, so order is not the contract —
 *  membership is. */
async function metaPolicy(request: APIRequestContext, path: string) {
	const html = await (await request.get(path)).text();
	const meta = /<meta http-equiv="content-security-policy" content="([^"]+)"/.exec(html);

	expect(meta, `no CSP meta tag emitted on ${path}`).not.toBeNull();
	return new Map(
		(meta?.[1] ?? '')
			.split(';')
			.map((part) => part.trim().split(/\s+/))
			.filter((words) => words[0] !== undefined && words[0] !== '')
			.map(([name, ...values]) => [name, values.sort()] as const)
	);
}

test('the CSP carries the hash for SvelteKit inline script', async ({ request }) => {
	// SvelteKit emits the main policy itself (svelte.config.js kit.csp, hash
	// mode) because it must include a hash for its hydration bootstrap. A bare
	// `script-src 'self'` blocks that script, and the only visible symptom is
	// that the page stops responding to clicks — so assert the hash is there.
	const directives = await metaPolicy(request, '/');

	const script = directives.get('script-src') ?? [];
	expect(script.some((v) => /^'sha256-[A-Za-z0-9+/=]+'$/.test(v))).toBe(true);
});

test('every CSP directive is exactly the configured one', async ({ request }) => {
	// Exact sets, not "contains", and every directive rather than the four that
	// used to be pinned: the point of doc 15 §2 is that nothing else gets in.
	// Until 2026-09-29 `img-src`, `media-src` and `worker-src` could have grown
	// a source without a test going red — and Week 7's players live in exactly
	// those three (blob: audio and video, blob: covers, the tag worker).
	//
	// `frame-ancestors` is absent from the meta tag by specification; it is
	// pinned as a header in the test above.
	for (const path of ['/', '/w/clock', '/legal/privacy']) {
		const directives = await metaPolicy(request, path);

		expect([...directives.keys()].sort(), path).toEqual(
			[
				'base-uri',
				'connect-src',
				'default-src',
				'font-src',
				'form-action',
				'frame-src',
				'img-src',
				'media-src',
				'object-src',
				'script-src',
				'style-src',
				'upgrade-insecure-requests',
				'worker-src'
			].sort()
		);

		expect(directives.get('default-src'), path).toEqual(["'self'"]);
		expect(
			(directives.get('script-src') ?? []).filter((v) => !v.startsWith("'sha256-")),
			path
		).toEqual(
			[
				"'self'",
				'https://challenges.cloudflare.com',
				'https://static.cloudflareinsights.com'
			].sort()
		);
		expect(directives.get('frame-src'), path).toEqual(['https://challenges.cloudflare.com']);
		// 'unsafe-inline' is why SvelteKit adds no style hashes, so this one is
		// exact with nothing filtered.
		expect(directives.get('style-src'), path).toEqual(["'self'", "'unsafe-inline'"].sort());
		expect(directives.get('img-src'), path).toEqual(
			["'self'", 'blob:', 'data:', 'https://tiles.openfreemap.org'].sort()
		);
		expect(directives.get('media-src'), path).toEqual(["'self'", 'blob:'].sort());
		expect(directives.get('connect-src'), path).toEqual(
			["'self'", 'https://cloudflareinsights.com', 'https://tiles.openfreemap.org'].sort()
		);
		expect(directives.get('font-src'), path).toEqual(["'self'"]);
		expect(directives.get('worker-src'), path).toEqual(["'self'"]);
		expect(directives.get('base-uri'), path).toEqual(["'self'"]);
		expect(directives.get('form-action'), path).toEqual(["'self'"]);
		expect(directives.get('object-src'), path).toEqual(["'none'"]);
		expect(directives.get('upgrade-insecure-requests'), path).toEqual([]);
	}
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
