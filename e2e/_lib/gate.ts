import { expect, type Page } from '@playwright/test';

/**
 * Loads the deck and accepts doc 16's legal gate, as every journey begins.
 *
 * Here rather than in each spec because it had been copied into eight of
 * them, and the ninth — the rss journey of Week 6 — was about to be the next
 * copy of a function that must change everywhere at once when the gate does.
 *
 * **The button is waited on until enabled**, not clicked on sight: it is
 * enabled only once hydration has attached its handler (the gate's `ready`
 * flag), so waiting is deterministic where a bare click races.
 *
 * `dismissCoach` clears doc 13 §9's one-time coach, which sits over the deck
 * and intercepts every click aimed at a tile. Journey #1 asserts that it
 * appears; a journey that goes on to click a tile has to move it first.
 */
export async function acceptGate(
	page: Page,
	options: { dismissCoach?: boolean } = {}
): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();

	if (options.dismissCoach === true) {
		await page.getByTestId('coach-dismiss').click();
		await expect(page.getByTestId('coach')).toBeHidden();
	}
}
