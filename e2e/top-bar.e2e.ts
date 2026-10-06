import { expect, test, type Page } from '@playwright/test';

/**
 * The top bar against the deck it sits over (doc 13 §1, doc 12 §2a).
 *
 * Measured, not counted. Every layout assertion elsewhere in the suite counts
 * `.grid-stack-item` wrappers, and a bar whose content sat 8 px off the grid's
 * edge on every screen wider than a phone passed all of them: doc 12 §2a
 * declared `--tp-page-pad` and `--tp-bar-h` tokens that did not exist, each use
 * carried its own 16 px fallback, and `main` hardcoded 24 px at ≥ 768 px.
 */

async function openDeck(page: Page): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
	await page.getByTestId('coach-dismiss').click();
	await expect(page.locator('.grid-stack-item').first()).toBeVisible();
}

async function left(page: Page, selector: string): Promise<number> {
	const box = await page.locator(selector).first().boundingBox();
	if (box === null) throw new Error(`${selector} has no box`);
	return box.x;
}

for (const width of [375, 768, 1280, 1920]) {
	test(`the bar's content lines up with the grid at ${String(width)} px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await openDeck(page);

		// doc 13 §1: page padding is measured to the grid *container*; tiles then
		// sit 12 px inside it by design, so the container is the edge to match.
		const brand = await left(page, '.tp-bar__brand');
		const grid = await left(page, '.grid-stack');
		expect(
			Math.abs(brand - grid),
			`brand at ${String(brand)}, grid at ${String(grid)}`
		).toBeLessThan(1);
	});
}

test('in edit mode, scrolling to a focused control clears the strip too (doc 13 §1)', async ({
	page
}) => {
	await openDeck(page);
	const padding = (): Promise<string> =>
		page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop);
	expect(await padding()).toBe('48px');

	await page.keyboard.press('e');
	await expect(page.getByTestId('edit-strip')).toBeVisible();
	// The bar (48) and the strip below it (40): a control Tab lands on must
	// not end up under either.
	expect(await padding()).toBe('88px');
});
