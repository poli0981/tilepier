import { expect, test, type Locator, type Page } from '@playwright/test';
import { acceptGate } from './_lib/gate';
import { seedLayout } from './_lib/seed';

/**
 * Focus you can see (WCAG 2.4.7, doc 13 §8), and states that survive forced
 * colours (doc 12 §10) — 1.3.0.
 *
 * Eight fields drew `outline: none` with nothing in its place, so the caret
 * was the only sign of focus; axe does not look for that, which is why it lived
 * through every sweep. Each is focused here and must then show a ring.
 *
 * Forced colours (Windows contrast themes) repaint every colour and drop
 * backgrounds and shadows, so a state drawn only by a fill disappears. Chromium
 * emulates the mode, and the checks are on what it computes.
 */

test.use({ viewport: { width: 1440, height: 1000 } });

/**
 * Whether a focused element shows a ring: an outline that is drawn, on it or on
 * one of the two boxes around it (a search box rings its field). Outlines only:
 * a tile's shadow is there with or without focus, and these fields' rings are
 * all outlines, which is also what forced colours keep.
 */
async function hasRing(locator: Locator): Promise<boolean> {
	return locator.evaluate((element) => {
		let node: Element | null = element;
		for (let depth = 0; depth < 3 && node !== null; depth += 1, node = node.parentElement) {
			const style = getComputedStyle(node);
			const drawn =
				style.outlineStyle !== 'none' &&
				parseFloat(style.outlineWidth) > 0 &&
				style.outlineColor !== 'transparent' &&
				style.outlineColor !== 'rgba(0, 0, 0, 0)';
			if (drawn) return true;
		}
		return false;
	});
}

async function expectFocusShows(locator: Locator): Promise<void> {
	await locator.focus();
	await expect(locator).toBeFocused();
	expect(await hasRing(locator)).toBe(true);
}

const TILES = [
	{ instanceId: 'wgt_f_notes', widgetId: 'notes', x: 0, y: 0, w: 3, h: 3, settings: {} },
	{ instanceId: 'wgt_f_todo', widgetId: 'todo', x: 3, y: 0, w: 3, h: 3, settings: {} },
	{ instanceId: 'wgt_f_clock', widgetId: 'clock', x: 6, y: 0, w: 3, h: 2, settings: {} }
];

function tile(page: Page, instanceId: string): Locator {
	return page.locator(`.grid-stack-item[gs-id="${instanceId}"]`);
}

async function openDetail(page: Page, instanceId: string): Promise<Locator> {
	await tile(page, instanceId).getByRole('button', { name: 'mở chi tiết' }).click();
	const panel = page.getByTestId('detail-panel');
	await expect(panel).toBeVisible();
	return panel;
}

async function closeDetail(page: Page): Promise<void> {
	await page.getByTestId('detail-close').click();
	await expect(page.getByTestId('detail-panel')).toBeHidden();
}

test.describe('every field shows its focus', () => {
	test.beforeEach(async ({ page }) => {
		await seedLayout(page, TILES);
		await acceptGate(page, { dismissCoach: true });
		await expect(tile(page, 'wgt_f_clock')).toBeVisible();
	});

	test('the drawer search', async ({ page }) => {
		await page.getByTestId('open-drawer').click();
		await expectFocusShows(page.getByTestId('add-drawer').getByRole('searchbox'));
	});

	test('the notes tile and its detail', async ({ page }) => {
		const notes = tile(page, 'wgt_f_notes');
		// The empty state's one action makes a note and opens it for editing.
		await notes.getByTestId('notes-empty').getByRole('button').click();
		await expectFocusShows(notes.getByTestId('notes-editor'));

		const panel = await openDetail(page, 'wgt_f_notes');
		await expectFocusShows(panel.getByTestId('notes-search'));
		await expectFocusShows(panel.getByTestId('notes-detail-editor'));
	});

	test('the to-do tile and its detail', async ({ page }) => {
		const todo = tile(page, 'wgt_f_todo');
		await todo.getByTestId('todo-first-list').click();
		const input = todo.getByTestId('todo-input');
		await expectFocusShows(input);
		await input.fill('Mua sữa');
		await page.keyboard.press('Enter');
		await expect(todo.getByTestId('todo-items')).toContainText('Mua sữa');

		const panel = await openDetail(page, 'wgt_f_todo');
		await expectFocusShows(panel.getByTestId('todo-detail-text').first());
		await panel.getByTestId('todo-list').first().focus();
		await page.keyboard.press('F2');
		await expectFocusShows(panel.getByTestId('todo-rename-input'));
	});

	test('the clock detail zone search', async ({ page }) => {
		const panel = await openDetail(page, 'wgt_f_clock');
		await panel.getByTestId('add-zone').click();
		await expectFocusShows(panel.getByTestId('zone-search'));
		await closeDetail(page);
	});
});

test.describe('forced colours (doc 12 §10)', () => {
	test.use({ colorScheme: 'dark' });

	test('a pressed choice still looks pressed, and the chosen swatch keeps its colour', async ({
		page
	}) => {
		await acceptGate(page, { dismissCoach: true });
		await page.emulateMedia({ forcedColors: 'active' });
		await page.goto('/settings');
		await expect(page.locator('[data-ready="true"]')).toBeVisible();

		const style = (locator: Locator) =>
			locator.evaluate((element) => {
				const s = getComputedStyle(element);
				return { outline: s.outlineStyle, background: s.backgroundColor };
			});

		// The motion row: one pressed, two not. Without the forced-colours rule
		// all three computed alike, the fill that marked the choice repainted.
		const pressed = page.getByTestId('motion-system');
		await expect(pressed).toHaveAttribute('aria-pressed', 'true');
		expect((await style(pressed)).outline).toBe('solid');
		expect((await style(page.getByTestId('motion-on'))).outline).toBe('none');

		// A swatch *is* its colour, so it keeps it.
		const teal = page.getByTestId('accent-46d5c8');
		expect((await style(teal)).background).toBe('rgb(70, 213, 200)');
	});

	test('a field still shows its focus', async ({ page }) => {
		await acceptGate(page, { dismissCoach: true });
		await page.emulateMedia({ forcedColors: 'active' });
		await page.getByTestId('open-drawer').click();
		await expectFocusShows(page.getByTestId('add-drawer').getByRole('searchbox'));
	});
});
