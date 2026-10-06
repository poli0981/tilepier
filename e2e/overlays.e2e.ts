import { expect, test, type Locator, type Page } from '@playwright/test';
import { acceptGate } from './_lib/gate';

/**
 * The overlays at 400 % zoom, and at the end of their own scroll (doc 13 §8).
 *
 * WCAG 1.4.10 asks that content reflow at 320 CSS px without loss; 400 % zoom
 * of a 1280 × 1024 screen is 320 × 256. Every overlay is `position: fixed`, so
 * whatever it cannot show inside the screen the page cannot scroll to either —
 * a fixed box does not move with the page. Until 2026-10-06 the gate, the bug
 * dialog and the shortcuts sheet were centred and never scrolled, so at that
 * size the gate's heading sat above the top of the screen and its Accept button
 * below the bottom, with nothing a reader could do to reach either.
 */
const ZOOMED = { width: 320, height: 256 };

test('the gate can be read and accepted at 400 % zoom', async ({ page }) => {
	await page.setViewportSize(ZOOMED);
	await page.goto('/');

	// The panel starts at the top rather than overflowing both ends.
	await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();

	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	// A click scrolls its target into view first, which needs something that
	// scrolls; a short timeout so the parent fails on that, not on the test's.
	await accept.click({ timeout: 5_000 });
	await expect(page.getByRole('main')).toBeVisible();
});

test('the shortcuts sheet keeps its header on screen and scrolls inside', async ({ page }) => {
	await acceptGate(page, { dismissCoach: true });
	await page.setViewportSize(ZOOMED);

	await page.keyboard.press('?');
	const sheet = page.getByTestId('shortcuts');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'bỏ qua' })).toBeInViewport();

	const last = sheet.locator('dd').last();
	await last.scrollIntoViewIfNeeded({ timeout: 5_000 });
	await expect(last).toBeInViewport();
});

test('the bug dialog keeps its header on screen and scrolls inside', async ({ page }) => {
	await acceptGate(page, { dismissCoach: true });
	await page.goto('/settings');
	// Prerendered: the button is there before its onclick (journey #6).
	await expect(page.locator('[data-ready="true"]')).toBeAttached();
	await page.setViewportSize(ZOOMED);

	await page.getByTestId('open-bug').click();
	const dialog = page.getByTestId('bug-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'bỏ qua' })).toBeInViewport();

	const download = page.getByTestId('bug-download');
	await download.scrollIntoViewIfNeeded({ timeout: 5_000 });
	await expect(download).toBeInViewport();
});

/** Scrolls `pane` to its end, then wheels past it and reports whether the page moved. */
async function pageMovesPastTheEnd(page: Page, pane: Locator): Promise<boolean> {
	const scrolls = await pane.evaluate((element) => element.scrollHeight > element.clientHeight);
	expect(scrolls, 'the pane must scroll for this to mean anything').toBe(true);
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight), {
			message: 'the page behind must scroll too, or a chained wheel could not move it'
		})
		.toBe(true);
	await pane.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const before = await page.evaluate(() => window.scrollY);

	const box = await pane.boundingBox();
	if (box === null) throw new Error('the pane has no box');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.wheel(0, 400);
	// A wheel scroll is applied over frames; give a chained one time to land.
	await page.waitForTimeout(300);
	return (await page.evaluate(() => window.scrollY)) !== before;
}

test('a wheel at the end of a detail does not scroll the deck behind it', async ({ page }) => {
	// Short enough that the detail's body scrolls, and the deck behind it too.
	await page.setViewportSize({ width: 600, height: 300 });
	await acceptGate(page, { dismissCoach: true });

	await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
	const panel = page.getByTestId('detail-panel');
	await expect(panel).toBeVisible();
	await panel.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished))
	);

	expect(await pageMovesPastTheEnd(page, panel.locator('.tp-detail__body'))).toBe(false);
});

test('a wheel at the end of the add drawer does not scroll the deck behind it', async ({
	page
}) => {
	await page.setViewportSize({ width: 600, height: 300 });
	await acceptGate(page, { dismissCoach: true });

	await page.getByTestId('open-drawer').click();
	const drawer = page.getByTestId('add-drawer');
	await expect(drawer).toBeVisible();

	expect(await pageMovesPastTheEnd(page, drawer)).toBe(false);
});
