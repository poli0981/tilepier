import { expect, test, type Page } from '@playwright/test';
import { acceptGate } from './_lib/gate';
import { seedLayout } from './_lib/seed';

/**
 * The keyboard journey (doc 19 §4, doc 13 §8), 1.3.0: everything a reader with
 * no pointer has to be able to do, done with keys alone after the setup.
 *
 * - Arrange a tile — move, swap, resize — and find it where they left it after
 *   a reload (WCAG 2.1.1 and 2.5.7: until 1.3.0 a tile moved only by dragging).
 * - Turn the single-key shortcuts off, and still reach their list (2.1.4).
 * - Esc out of a field without closing more than they meant to.
 * - Remove a tile and keep their place on the deck.
 * - Skip past the bar.
 *
 * **1440 px wide**, as `s1-grid` is: below 1280 the grid runs six columns
 * (doc 06 §5.4), and these positions are written for twelve.
 */

test.use({ viewport: { width: 1440, height: 1000 } });

const LAYOUT_KEY = 'tp.layout.v1';

const CLOCK = {
	instanceId: 'wgt_k_clock',
	widgetId: 'clock',
	x: 0,
	y: 0,
	w: 3,
	h: 2,
	settings: {}
};
const NOTES = {
	instanceId: 'wgt_k_notes',
	widgetId: 'notes',
	x: 0,
	y: 2,
	w: 4,
	h: 3,
	settings: {}
};

function item(page: Page, instanceId: string) {
	return page.locator(`.grid-stack-item[gs-id="${instanceId}"]`);
}

async function storedTile(
	page: Page,
	instanceId: string
): Promise<{ x: number; y: number; w: number; h: number } | null> {
	return page.evaluate(
		([key, id]) => {
			const raw = localStorage.getItem(key);
			if (raw === null) return null;
			const tile = (
				JSON.parse(raw) as {
					grid: { instanceId: string; x: number; y: number; w: number; h: number }[];
				}
			).grid.find((entry) => entry.instanceId === id);
			return tile === undefined ? null : { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
		},
		[LAYOUT_KEY, instanceId] as const
	);
}

test('a tile moves, swaps and resizes from the keyboard, and stays put after a reload', async ({
	page
}) => {
	await seedLayout(page, [CLOCK, NOTES]);
	await acceptGate(page, { dismissCoach: true });
	await expect(item(page, CLOCK.instanceId)).toBeVisible();

	await page.keyboard.press('e');
	const arrange = page.getByTestId(`arrange-${CLOCK.instanceId}`);
	await arrange.focus();
	await page.keyboard.press('Enter');

	const dialog = page.getByTestId('arrange-dialog');
	await expect(dialog).toBeFocused();

	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect(item(page, CLOCK.instanceId)).toHaveAttribute('gs-x', '2');

	// Down swaps with the tile below. `y + 1` would have been floated straight
	// back by gridstack, which is the bug the planner is written around.
	await page.keyboard.press('ArrowDown');
	await expect(item(page, NOTES.instanceId)).toHaveAttribute('gs-y', '0');
	await expect(item(page, CLOCK.instanceId)).toHaveAttribute('gs-y', '3');

	await page.keyboard.press('Shift+ArrowRight');
	await expect(item(page, CLOCK.instanceId)).toHaveAttribute('gs-w', '4');
	await expect(page.getByTestId('arrange-status')).not.toBeEmpty();

	// Esc closes the dialog and only the dialog, and focus goes back.
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('main')).toHaveAttribute('data-edit', 'on');
	await expect(arrange).toBeFocused();

	// doc 04 §6: the layout write is debounced 500 ms.
	await expect.poll(() => storedTile(page, CLOCK.instanceId)).toEqual({ x: 2, y: 3, w: 4, h: 2 });

	await page.reload();
	await expect(item(page, CLOCK.instanceId)).toHaveAttribute('gs-x', '2');
	await expect(item(page, CLOCK.instanceId)).toHaveAttribute('gs-y', '3');
	await expect(item(page, CLOCK.instanceId)).toHaveAttribute('gs-w', '4');
	await expect(item(page, NOTES.instanceId)).toHaveAttribute('gs-y', '0');
});

test('with single-key shortcuts off, e does nothing and Settings still opens their list', async ({
	page
}) => {
	await acceptGate(page, { dismissCoach: true });
	await page.goto('/settings');
	await expect(page.locator('[data-ready="true"]')).toBeVisible();

	await page.getByTestId('shortcuts-off').focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('shortcuts-off')).toHaveAttribute('aria-pressed', 'true');

	await page.getByTestId('open-shortcuts').focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('shortcuts')).toBeFocused();
	await expect(page.getByTestId('shortcuts-off-note')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('shortcuts')).toBeHidden();
	await expect(page.getByTestId('open-shortcuts')).toBeFocused();

	await page.goto('/');
	await expect(page.locator('.grid-stack-item').first()).toBeVisible();
	await page.keyboard.press('e');
	await page.keyboard.press('?');
	await expect(page.getByRole('main')).toHaveAttribute('data-edit', 'off');
	await expect(page.getByTestId('shortcuts')).toHaveCount(0);
});

test('Esc in the drawer search closes the drawer, and only the drawer', async ({ page }) => {
	await acceptGate(page, { dismissCoach: true });
	await page.getByTestId('open-drawer').focus();
	await page.keyboard.press('Enter');

	const search = page.getByTestId('add-drawer').getByRole('searchbox');
	await search.focus();
	await page.keyboard.type('đồng');
	await page.keyboard.press('Escape');

	await expect(page.getByTestId('add-drawer')).toBeHidden();
	await expect(page.getByRole('main')).toHaveAttribute('data-edit', 'on');
	await expect(page.getByTestId('open-drawer')).toBeFocused();
});

test('Esc in a list rename cancels the rename, not the detail, and keeps the name', async ({
	page
}) => {
	await seedLayout(page, [
		{ instanceId: 'wgt_k_todo', widgetId: 'todo', x: 0, y: 0, w: 3, h: 3, settings: {} }
	]);
	await acceptGate(page, { dismissCoach: true });
	await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
	const panel = page.getByTestId('detail-panel');
	await expect(panel).toBeVisible();

	await panel.getByTestId('todo-new-list').click();
	const list = panel.getByTestId('todo-list').first();
	await expect(list).toBeVisible();
	const before = (await list.textContent())?.trim();

	// F2 is the keyboard's way into a rename (a double-click was the only one).
	await list.focus();
	await page.keyboard.press('F2');
	const field = panel.getByTestId('todo-rename-input');
	await expect(field).toBeFocused();
	await page.keyboard.type('Đã đổi');
	await page.keyboard.press('Escape');

	// A detail closes after its FLIP out, so "still visible" is only an answer
	// once every animation the keystroke could have started has finished. The
	// first draft asserted at once and passed with the bug in place.
	// Finite ones only: the brand's tide gauge loops for ever (as in e2e/a11y).
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY
				)
				.map((animation) => animation.finished.catch(() => null))
		)
	);
	await expect(page).toHaveURL(/[?&]i=wgt_k_todo/);
	await expect(panel).toBeVisible();
	await expect(field).toHaveCount(0);
	await expect(panel.getByTestId('todo-list').first()).toHaveText(before ?? '');
	await expect(panel.getByTestId('todo-list').first()).toBeFocused();
});

test('removing a tile leaves focus on the next one, and says so', async ({ page }) => {
	await seedLayout(page, [CLOCK, NOTES]);
	await acceptGate(page, { dismissCoach: true });
	await expect(item(page, NOTES.instanceId)).toBeVisible();

	await page.keyboard.press('e');
	await page.getByTestId(`remove-${CLOCK.instanceId}`).focus();
	await page.keyboard.press('Enter');

	await expect(item(page, CLOCK.instanceId)).toHaveCount(0);
	const next = item(page, NOTES.instanceId).locator('[data-tile-focus]');
	await expect(next).toBeFocused();
	await expect(page.getByTestId('deck-announce')).not.toBeEmpty();

	// The last one goes back to Add widget, the one control left to use.
	await page.getByTestId(`remove-${NOTES.instanceId}`).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('open-drawer')).toBeFocused();
});

test('the first Tab offers a way past the bar', async ({ page }) => {
	await acceptGate(page, { dismissCoach: true });
	// A fresh load, so the first Tab starts from the top of the document.
	await page.reload();
	await expect(page.locator('.grid-stack-item').first()).toBeVisible();

	await page.keyboard.press('Tab');
	const skip = page.locator('.tp-skip');
	await expect(skip).toBeFocused();
	const box = await skip.boundingBox();
	expect(box?.height ?? 0).toBeGreaterThanOrEqual(39.5);

	await page.keyboard.press('Enter');
	await expect(page.locator('#tp-main')).toBeFocused();
});
