import { expect, test } from '@playwright/test';
import { SEEDED_TILES } from './_lib/seed';

/**
 * doc 19 §4 journey #1 — first run, end to end: gate → accept → seeded deck →
 * coach dismissed.
 *
 * The JavaScript-disabled block is the only assertion that actually proves
 * "pre-JS" (doc 16 §2). Everything else in the suite runs with a bundle loaded,
 * where a prerendered element and a hydrated one look identical.
 */

test.describe('with JavaScript disabled entirely', () => {
	test.use({ javaScriptEnabled: false });

	test('the gate is really in the HTML, not injected', async ({ page }) => {
		await page.goto('/');

		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page.locator('.tp-gate [data-locale="vi"]')).toBeVisible();
	});

	test('accepting is disabled, because accepting needs JavaScript', async ({ page }) => {
		await page.goto('/');

		// The honest state for an app that cannot work without a bundle. Leaving
		// it enabled would mean a consent button that silently does nothing.
		await expect(page.getByTestId('gate-accept').first()).toBeDisabled();
	});

	test('every page the gate links to is readable', async ({ page }) => {
		// doc 16 §2: a visitor has to be able to read what they are agreeing to.
		for (const path of ['/legal/terms', '/legal/privacy', '/legal/licenses', '/about']) {
			await page.goto(path);
			await expect(page.getByRole('heading').first()).toBeVisible();
		}
	});

	test('?lang= does nothing, because boot.js is itself JavaScript', async ({ page }) => {
		await page.goto('/?lang=en');

		// Measured, not assumed. The link pair buys the gap between first paint
		// and hydration — which is real and worth having — but not this. The
		// language falls back to what app.html declares (doc 14 §6).
		await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
	});
});

test('first run: gate, accept, seeded deck, coach, dismissed for good', async ({ page }) => {
	await page.goto('/');

	// 1 · the gate blocks the deck
	await expect(page.getByRole('dialog')).toBeVisible();
	await expect(page.getByRole('main')).toBeHidden();

	// 2 · accepting reveals it
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByRole('main')).toBeVisible();

	// 3 · the seeded deck renders — doc 13 §9, registry-filtered. Two tiles as
	//     of Week 2 (clock and notes); the full five arrive with calendar and
	//     quote in Week 3.
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES);
	await expect(page.locator('.tp-clock__time')).toBeVisible();

	// 4 · the coach appears once and is dismissible
	await expect(page.getByTestId('coach')).toBeVisible();
	await page.getByTestId('coach-dismiss').click();
	await expect(page.getByTestId('coach')).toBeHidden();

	// 5 · none of it comes back
	await page.reload();
	await expect(page.getByRole('dialog')).toBeHidden();
	await expect(page.getByTestId('coach')).toBeHidden();
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES);
});

test('the seeded deck is shown but not committed until something touches it', async ({ page }) => {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await page.getByTestId('coach-dismiss').click();

	// The seed renders, but nothing has been stored: a visitor who bounces
	// leaves no layout behind, and the first real action is what commits it.
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES);
	expect(await page.evaluate(() => localStorage.getItem('tp.layout.v1'))).toBeNull();
});

test('first run creates exactly the three documented localStorage keys', async ({ page }) => {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await page.getByTestId('coach-dismiss').click();

	// A real deck action, which is what commits the layout.
	await page.getByTestId('open-drawer').click();
	await page.getByTestId('add-clock').click();
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES + 1);

	// doc 05 §2 and CLAUDE.md rule 10. The type system forbids a fourth in
	// source; this checks nothing reached storage by another route — Paraglide's
	// own localStorage strategy would have written PARAGLIDE_LOCALE here.
	// Polled, because the layout write is debounced 500 ms (doc 04 §6).
	await expect
		.poll(() => page.evaluate(() => Object.keys(localStorage).sort()))
		.toEqual(['tp.layout.v1', 'tp.legal.v1', 'tp.settings.v1']);
});

test('a returning visitor never sees the gate flash', async ({ page }) => {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();

	// boot.js sets data-legal before first paint, so the attribute is already
	// there on the very first frame of the next load (doc 16 §2).
	await page.goto('/');
	const legalBeforePaint = await page.evaluate(
		() => document.documentElement.dataset['legal'] ?? null
	);
	expect(legalBeforePaint).toBe('ok');
});
