import { expect, test, type Page } from '@playwright/test';
import { seedLayout } from './_lib/seed';

/**
 * The two promises doc 07 §2 makes that only a real browser can be held to:
 * a running timer survives a reload, and a deadline that passed while nobody
 * was looking says so instead of pretending or auto-starting the next phase.
 *
 * Both rest on `endsAt` being an absolute instant in the tile's own settings
 * (doc 05 §2) rather than a number counting down in component state. That is a
 * decision with a visible consequence, so it gets a test that can see it.
 */

const LAYOUT_KEY = 'tp.layout.v1';

async function acceptGate(page: Page): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
}

/** Puts a single timer tile on the deck with the given settings. */
async function seedTimer(page: Page, settings: Record<string, unknown>): Promise<void> {
	await seedLayout(page, [
		{ instanceId: 'wgt_timer1', widgetId: 'timer', x: 0, y: 0, w: 3, h: 2, settings }
	]);
	await page.reload();
}

test('a running timer keeps its deadline across a reload', async ({ page }) => {
	await acceptGate(page);
	await seedTimer(page, { mode: 'countdown', durationMs: 600_000, muted: true });

	await page.getByTestId('timer-primary').click();
	await expect(page.getByTestId('timer-readout')).toHaveText(/^(9:5\d|10:00)$/);

	// doc 04 §6: the layout write is debounced 500 ms after the change settles.
	await expect(async () => {
		const endsAt = await page.evaluate((key) => {
			const raw = localStorage.getItem(key);
			if (raw === null) return null;
			const parsed = JSON.parse(raw) as { grid: { settings: { endsAt?: number } }[] };
			return parsed.grid[0]?.settings.endsAt ?? null;
		}, LAYOUT_KEY);
		expect(endsAt).toBeGreaterThan(Date.now());
	}).toPass({ timeout: 5000 });

	await page.reload();

	// Still counting, and still counting *down* — not restarted at 10:00.
	await expect(page.getByTestId('timer-readout')).toHaveText(/^9:[0-5]\d$/);
	await expect(page.getByTestId('timer-primary')).toHaveText('tạm dừng');
});

test('a deadline that passed while away says so, and starts nothing', async ({ page }) => {
	await acceptGate(page);

	// Ten minutes past its deadline: a shut laptop, not a throttled tab.
	await seedTimer(page, {
		mode: 'pomodoro',
		phase: 'break',
		breakMs: 300_000,
		endsAt: Date.now() - 600_000,
		muted: true
	});

	await expect(page.getByTestId('timer-finished')).toHaveText('kết thúc lúc bạn vắng mặt');

	// doc 07 §2: the next phase is queued up, not running. The button offers to
	// start it; the readout sits at the top of the phase rather than counting.
	await expect(page.getByTestId('timer-phase')).toHaveText('tập trung');
	await expect(page.getByTestId('timer-primary')).toContainText('bắt đầu');

	// And the cleared deadline is written back, so a second reload does not
	// re-announce the same finish.
	await expect(async () => {
		const endsAt = await page.evaluate((key) => {
			const raw = localStorage.getItem(key);
			if (raw === null) return undefined;
			const parsed = JSON.parse(raw) as { grid: { settings: { endsAt?: number | null } }[] };
			return parsed.grid[0]?.settings.endsAt;
		}, LAYOUT_KEY);
		expect(endsAt).toBeNull();
	}).toPass({ timeout: 5000 });

	await page.reload();
	await expect(page.getByTestId('timer-finished')).toBeHidden();
});

test('the detail configures the tile it was opened from', async ({ page }) => {
	await acceptGate(page);
	await seedTimer(page, { mode: 'countdown', durationMs: 600_000, muted: true });

	await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
	await expect(page.getByTestId('detail-panel')).toBeVisible();

	await page.getByTestId('timer-mode-pomodoro').click();
	await page.keyboard.press('Escape');

	// The tile behind the panel is reading the same settings bag.
	await expect(page.getByTestId('timer-phase')).toHaveText('tập trung');
});
