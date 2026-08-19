import { expect, test } from '@playwright/test';

/**
 * doc 17 §1. The error page sits at the route root rather than inside `(app)`,
 * so it renders for a visitor who has not passed the legal gate — which is the
 * case where an error page matters most.
 */

test('an unknown route renders the 404 page, gate or no gate', async ({ page }) => {
	await page.goto('/khong-ton-tai');

	await expect(page.getByRole('heading', { name: 'trang này chưa cập bến' })).toBeVisible();
	// Not trapped behind the consent wall: the gate belongs to `(app)`.
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('link', { name: /về bàn/ })).toBeVisible();
});

test('the 404 page carries no report button', async ({ page }) => {
	await page.goto('/khong-ton-tai');

	// A missing page is routing, not a fault — nothing to report and nothing in
	// the ring buffer, so offering the flow would only produce noise.
	await expect(page.getByTestId('error-report')).toHaveCount(0);
	await expect(page.getByTestId('error-id')).toHaveCount(0);
});

test('the bug dialog assembles a report the user can read and edit', async ({ page }) => {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await page.goto('/settings');

	await page.getByTestId('open-bug').click();
	await expect(page.getByTestId('bug-dialog')).toBeVisible();

	const body = page.getByTestId('bug-body');
	const text = await body.inputValue();

	// doc 18 §2: environment, a layout hash, and the log — never the layout.
	expect(text).toContain('version:');
	expect(text).toContain('layoutHash:');
	expect(text).toContain('widgets: clock');
	expect(text).toContain('--- log ---');
	expect(text).not.toContain('"grid"');

	// doc 18 §4: editable, because the user reviews before sending.
	await body.fill('trimmed by hand');
	expect(await body.inputValue()).toBe('trimmed by hand');
});

test('the report carries the boot line, so a build can be identified', async ({ page }) => {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await page.goto('/settings');
	await page.getByTestId('open-bug').click();

	const text = await page.getByTestId('bug-body').inputValue();

	// doc 18 §1's boot line is the first thing in every ring buffer.
	// formatLog upper-cases and pads the level, so this is INFO, not info.
	expect(text).toMatch(/INFO\s+\[boot\] TilePier \S+ \S+/);
});
