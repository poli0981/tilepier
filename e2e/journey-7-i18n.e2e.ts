import { expect, test, type Page } from '@playwright/test';

/**
 * doc 19 §4 journey #7 — the language switch, plus the settings surfaces that
 * arrived with it.
 *
 * The interesting assertion is the last one: no visible text may look like a
 * message key. A missing key renders as its own name, which reads as a typo
 * rather than a failure unless something is watching for the shape.
 */

async function acceptGate(page: Page): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
}

test('settings is reachable from the top bar', async ({ page }) => {
	await acceptGate(page);

	await page.getByRole('link', { name: 'Cài đặt' }).click();

	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByRole('heading', { name: 'Cài đặt', level: 1 })).toBeVisible();
});

test('switching to English reloads and sticks', async ({ page }) => {
	await acceptGate(page);
	await page.goto('/settings');
	// The controls are onclick handlers; clicking before hydration attaches them
	// is a click into nothing. `data-ready` flips with `browser`.
	await expect(page.locator('[data-ready="true"]')).toBeAttached();

	await page.getByTestId('locale-en').click();

	// doc 14 §1: the switch reloads. Assert on something that only exists after
	// that reload *first* — checking <html lang> straight away races the
	// navigation and reads the outgoing document.
	await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('the language change reaches the gate, which is prerendered', async ({ page }) => {
	await acceptGate(page);
	await page.goto('/settings');
	await expect(page.locator('[data-ready="true"]')).toBeAttached();
	await page.getByTestId('locale-en').click();
	// Same reason as above: wait for the reloaded document before reading it.
	await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	// Clear acceptance so the gate comes back, and check the half CSS reveals.
	await page.evaluate(() => localStorage.removeItem('tp.legal.v1'));
	await page.goto('/');

	await expect(page.getByRole('button', { name: 'I agree' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Tôi đồng ý' })).toHaveCount(0);
});

test('the theme choice applies without a reload', async ({ page }) => {
	await acceptGate(page);
	await page.goto('/settings');
	await expect(page.locator('[data-ready="true"]')).toBeAttached();

	await page.getByTestId('theme-light').click();

	// Theme does not reload — that is the point of the assertion.
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a custom accent reaches the derived tokens, not just the base', async ({ page }) => {
	await acceptGate(page);
	await page.goto('/settings');
	await expect(page.locator('[data-ready="true"]')).toBeAttached();

	await page.getByTestId('accent-e8b750').click();

	// doc 12 §2: JS sets only --color-beacon; soft and deep are derived in CSS,
	// so an accent that only changed the base would be a silent half-change.
	const soft = await page.evaluate(() =>
		getComputedStyle(document.documentElement).getPropertyValue('--color-beacon-soft').trim()
	);
	expect(soft).not.toBe('');
	expect(soft).not.toContain('46d5c8');
});

test('the shortcuts sheet opens on ? and closes on Escape', async ({ page }) => {
	await acceptGate(page);

	await page.keyboard.press('?');
	await expect(page.getByTestId('shortcuts')).toBeVisible();

	// Esc unwinds the topmost layer first (doc 13 §8).
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('shortcuts')).toBeHidden();
});

test('no visible text looks like an untranslated message key', async ({ page }) => {
	for (const path of ['/', '/settings', '/about', '/legal/privacy']) {
		await page.goto(path);
		const text = await page.locator('body').innerText();
		// e.g. `settings.appearance.theme` leaking through as its own name.
		expect(text, `on ${path}`).not.toMatch(/\b(common|widget|settings|legal|about)\.[a-z_.]+\b/);
	}
});
