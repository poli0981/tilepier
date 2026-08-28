import { expect, test, type Page } from '@playwright/test';
import { seedLayout } from './_lib/seed';

/**
 * The detail-expansion handshake (doc 06 §6, doc 13 §5).
 *
 * Not one of doc 19 §4's numbered journeys — journey #3 is the weather detail
 * and arrives in Week 4 with a chart to assert on. What this file covers is the
 * *mechanism* underneath it, which landed in Week 2 with the clock: the push,
 * the four ways out, the deep link, and the one thing that would be a real bug
 * rather than a broken feature — the deep link rendering user data in front of
 * the legal gate.
 */

const LAYOUT_KEY = 'tp.layout.v1';

async function acceptGate(page: Page): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
}

async function openClockDetail(page: Page): Promise<void> {
	await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
	await expect(page.getByTestId('detail-panel')).toBeVisible();
}

test('the tile opens its detail, and the URL says which instance', async ({ page }) => {
	await acceptGate(page);
	await openClockDetail(page);

	// doc 06 §6: shallow routing to /w/[id]?i=<instanceId>.
	await expect(page).toHaveURL(/\/w\/clock\?i=wgt_/);
	// The chunk really mounted — this string belongs to TpClockDetail, not the frame.
	await expect(page.getByText('múi giờ của bạn')).toBeVisible();
});

test('Escape closes it and returns to the deck URL', async ({ page }) => {
	await acceptGate(page);
	await openClockDetail(page);

	await page.keyboard.press('Escape');

	await expect(page.getByTestId('detail-panel')).toBeHidden();
	await expect(page).toHaveURL(/\/$/);
	// doc 13 §8: Escape closes the topmost layer only. The deck must not have
	// dropped out of view mode or done anything else on the same keystroke.
	await expect(page.getByRole('main')).toBeVisible();
});

test('the scrim closes it', async ({ page }) => {
	await acceptGate(page);
	await openClockDetail(page);

	await page.getByTestId('detail-scrim').click({ position: { x: 5, y: 5 } });

	await expect(page.getByTestId('detail-panel')).toBeHidden();
});

test('browser Back closes it, and Forward reopens it', async ({ page }) => {
	await acceptGate(page);
	await openClockDetail(page);

	await page.goBack();
	await expect(page.getByTestId('detail-panel')).toBeHidden();

	// The push was a real history entry, so Forward has somewhere to go — this
	// is what "shallow routing" buys over a local open/closed flag.
	await page.goForward();
	await expect(page.getByTestId('detail-panel')).toBeVisible();
});

test('a deep link renders the detail standalone', async ({ page }) => {
	await acceptGate(page);

	await page.goto('/w/clock');

	// doc 13 §5.4: full-screen, no overlay, and a way back.
	await expect(page.getByTestId('detail-standalone')).toBeVisible();
	await expect(page.getByTestId('detail-panel')).toBeHidden();
	await expect(page.getByRole('link', { name: /về bàn/ })).toBeVisible();
});

test('a deep link is behind the legal gate', async ({ page }) => {
	// The reason `w/[id]` lives inside the (app) route group. Doc 03's tree drew
	// it outside, which would have served notes and todo content full-screen to
	// someone who had not accepted the terms. A fresh context has not accepted.
	await page.goto('/w/clock');

	await expect(page.getByTestId('gate-accept').first()).toBeVisible();
	await expect(page.getByTestId('detail-standalone')).toBeHidden();
});

test('a deep link naming an unknown instance still shows the widget', async ({ page }) => {
	await acceptGate(page);

	// A link shared between two browsers carries an instance id the other one
	// has never seen. Falling back to the first tile of that widget beats an
	// error page for what is, to the reader, the same widget.
	await page.goto('/w/clock?i=wgt_nosuch');

	await expect(page.getByTestId('detail-standalone')).toBeVisible();
	await expect(page.getByText('múi giờ của bạn')).toBeVisible();
});

test('a deep link to a widget not on the deck offers to pin it', async ({ page }) => {
	await acceptGate(page);

	// Empty the deck first, so the clock genuinely is not on it.
	await seedLayout(page, []);

	await page.goto('/w/clock');

	// doc 13 §5.4.
	const pin = page.getByTestId('pin-to-deck');
	await expect(pin).toBeVisible();
	await pin.click();

	await expect(page.getByTestId('detail-standalone')).toBeVisible();
});

test('the detail reads and writes the tile settings it was opened for', async ({ page }) => {
	await acceptGate(page);
	await openClockDetail(page);

	// doc 06 §2: onUpdateSettings persists into tp.layout.v1.
	await page.getByTestId('clock-seconds').check();

	await expect(async () => {
		const layout = await page.evaluate((key) => {
			const raw = localStorage.getItem(key);
			return raw === null ? null : (JSON.parse(raw) as { grid: { settings: unknown }[] });
		}, LAYOUT_KEY);
		expect(layout?.grid[0]?.settings).toMatchObject({ showSeconds: true });
	}).toPass({ timeout: 5000 });
});
