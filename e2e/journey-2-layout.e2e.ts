import { expect, test, type Page } from '@playwright/test';
import { SEEDED_TILES, seedLayout } from './_lib/seed';

/**
 * doc 19 §4 journey #2 — layout persistence.
 *
 * The full loop: the seeded deck renders, the drawer adds a tile, edit mode is
 * reachable, a drag survives a reload, a tile can be removed, and a layout
 * naming a widget this build does not have degrades instead of breaking.
 *
 * And, since 2026-08-30, that a deck simply *survives being loaded* — which
 * sounds too obvious to assert until it stops being true. See the last test.
 */

const LAYOUT_KEY = 'tp.layout.v1';

async function acceptGate(page: Page): Promise<void> {
	await page.goto('/');
	// Enabled only once hydration has attached the handler — see the gate's
	// `ready` flag. Waiting on it is deterministic; a bare click races.
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
}

async function storedLayout(
	page: Page
): Promise<{ grid: { widgetId: string; x: number; y: number }[] } | null> {
	return page.evaluate((key) => {
		const raw = localStorage.getItem(key);
		return raw === null ? null : JSON.parse(raw);
	}, LAYOUT_KEY);
}

test('the seeded deck renders on first run', async ({ page }) => {
	await acceptGate(page);

	// doc 13 §9, registry-filtered: clock and notes as of Week 2, the full five
	// once calendar and quote land in Week 3.
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES);
	await expect(page.getByRole('heading', { name: 'TilePier' })).toHaveCount(0);
	await expect(page.locator('.tp-host__title').first()).toHaveText('Đồng hồ');
});

test('the clock ticks, and reads its per-instance settings', async ({ page }) => {
	await acceptGate(page);

	// Seeded through the layout key, which is where doc 05 §2 puts per-instance
	// settings — so this covers the tile reading them as well as the tick.
	// Without `showSeconds` the display only changes once a minute, which does
	// not fit inside a 30 s test timeout.
	await seedLayout(page, [
		{
			instanceId: 'wgt_tick',
			widgetId: 'clock',
			x: 0,
			y: 0,
			w: 3,
			h: 2,
			settings: { showSeconds: true }
		}
	]);
	await page.reload();

	const time = page.locator('.tp-clock__time');
	await expect(time).toBeVisible();
	// Seconds present means the tile settings reached the widget.
	await expect(time).toHaveText(/\d{1,2}:\d{2}:\d{2}/);

	// It ticks from a 1 s interval but computes from Date.now() (doc 07 §1).
	const first = await time.textContent();
	await expect(async () => {
		expect(await time.textContent()).not.toBe(first);
	}).toPass({ timeout: 5000 });
});

test('e enters edit mode and Escape leaves it', async ({ page }) => {
	await acceptGate(page);
	const main = page.getByRole('main');

	await expect(main).toHaveAttribute('data-edit', 'off');
	await page.keyboard.press('e');
	await expect(main).toHaveAttribute('data-edit', 'on');
	await page.keyboard.press('Escape');
	await expect(main).toHaveAttribute('data-edit', 'off');
});

test('a drag survives a reload', async ({ page }) => {
	await acceptGate(page);
	await page.keyboard.press('e');

	const handle = page.locator('.tp-drag').first();
	const box = await handle.boundingBox();
	expect(box).not.toBeNull();

	// Right by roughly two columns, and deliberately **not** downward. The seed
	// puts notes directly below the clock (doc 13 §9), and with `float: false`
	// (doc 06 §5.4) a drag into an occupied row is compacted straight back to
	// where it started — which looks exactly like a drag that never worked.
	// Sideways there is nothing to collide with, and the assertion still says
	// what it means to say.
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.mouse.down();
	await page.mouse.move(box!.x + box!.width / 2 + 260, box!.y + box!.height / 2, { steps: 12 });
	await page.mouse.up();

	const moved = await page
		.locator('.grid-stack-item')
		.first()
		.evaluate((el) => ({ x: el.getAttribute('gs-x'), y: el.getAttribute('gs-y') }));
	expect(moved.x).not.toBe('0');

	// doc 04 §6: the write is debounced 500 ms after the change settles.
	await expect(async () => {
		const layout = await storedLayout(page);
		expect(layout?.grid[0]?.x).toBe(Number(moved.x));
		expect(layout?.grid[0]?.y).toBe(Number(moved.y));
	}).toPass({ timeout: 5000 });

	await page.reload();

	const after = await page
		.locator('.grid-stack-item')
		.first()
		.evaluate((el) => ({ x: el.getAttribute('gs-x'), y: el.getAttribute('gs-y') }));
	expect(after).toEqual(moved);
});

test('a deck that gridstack has to compact survives repeated reloads', async ({ page }) => {
	// The assertion this suite did not have, and the one that catches doc 06 §5
	// rule 13: `TpGrid.setup()` added the tiles without suppressing change
	// events, and gridstack fires `change` synchronously from inside `addWidget`
	// the moment an insertion repositions the tiles already placed. Mid-loop
	// that reports a *prefix* of the deck, and the deck store persists what it
	// is handed — so `tp.layout.v1` was truncated to however many tiles had been
	// added when the first collision happened, permanently.
	//
	// The layout below is the one that surfaced it: the weather tile overlaps
	// what is already placed, so gridstack repositions on the third `addWidget`
	// and three of five tiles were stored. **The seeded deck does not trigger
	// it** — its tiles are laid out so nothing collides during the loop — which
	// is exactly why this was invisible through Week 3 and why the arrangement
	// here is written out rather than reusing the seed.
	//
	// The DOM count is not enough to see it: five wrappers render, three are
	// stored, and the reader loses two on the *next* load.
	await acceptGate(page);
	await seedLayout(page, [
		{ instanceId: 'wgt_a', widgetId: 'clock', x: 0, y: 0, w: 3, h: 2, settings: {} },
		{ instanceId: 'wgt_b', widgetId: 'calendar', x: 3, y: 0, w: 3, h: 3, settings: {} },
		{ instanceId: 'wgt_c', widgetId: 'notes', x: 6, y: 0, w: 3, h: 3, settings: {} },
		{ instanceId: 'wgt_d', widgetId: 'quote', x: 0, y: 2, w: 4, h: 2, settings: {} },
		{ instanceId: 'wgt_e', widgetId: 'todo', x: 4, y: 3, w: 3, h: 3, settings: {} }
	]);

	for (let run = 0; run < 3; run += 1) {
		await page.reload();
		await expect(page.locator('.grid-stack-item')).toHaveCount(5);

		await expect
			.poll(async () => (await storedLayout(page))?.grid.length, {
				message: `stored layout after reload ${String(run + 1)}`
			})
			.toBe(5);
	}
});

test('a tile naming an unbuilt widget is dropped, not fatal', async ({ page }) => {
	await acceptGate(page);

	// doc 05 §5. `rss` is in the id union and in doc 06 §7, but has no manifest
	// yet — exactly the shape of a widget removed in a future release, seen from
	// the other direction. It took this role from `weather` in Week 4.
	await seedLayout(page, [
		{ instanceId: 'wgt_keep', widgetId: 'clock', x: 0, y: 0, w: 3, h: 2, settings: {} },
		{ instanceId: 'wgt_gone', widgetId: 'rss', x: 3, y: 0, w: 3, h: 2, settings: {} }
	]);

	await page.reload();

	await expect(page.locator('.grid-stack-item')).toHaveCount(1);
	// Pruned and rewritten, so the warning does not repeat on every load.
	const layout = await storedLayout(page);
	expect(layout?.grid).toHaveLength(1);
	expect(layout?.grid[0]?.widgetId).toBe('clock');
});

test('the drawer adds a widget, and it survives a reload', async ({ page }) => {
	await acceptGate(page);
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES);

	// doc 13 §4: the drawer is an edit-mode surface, so opening it enters.
	await page.getByTestId('open-drawer').click();
	await expect(page.getByTestId('add-drawer')).toBeVisible();
	await expect(page.getByRole('main')).toHaveAttribute('data-edit', 'on');

	await page.getByTestId('add-clock').click();
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES + 1);

	await page.reload();
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES + 1);
});

test('a tile can be removed, and the removal sticks', async ({ page }) => {
	await acceptGate(page);
	await page.getByTestId('open-drawer').click();
	await page.getByTestId('add-clock').click();
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES + 1);
	// A corner rather than the midpoint: the drawer is a sheet on top of a
	// full-viewport scrim, and it grows with the registry. This passes today and
	// would start failing the week a widget pushes the sheet over the centre.
	await page.getByTestId('drawer-scrim').click({ position: { x: 4, y: 4 } });

	// doc 06 §4: no confirm — removing a tile never deletes underlying data.
	await page.locator('[data-testid^="remove-"]').first().click();
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES);

	await page.reload();
	await expect(page.locator('.grid-stack-item')).toHaveCount(SEEDED_TILES);
});

test('the coach shows once and stays dismissed', async ({ page }) => {
	await acceptGate(page);

	// doc 13 §9. "Forever" is tp.settings.v1.coachDismissed — there is no
	// fourth localStorage key for it.
	await expect(page.getByTestId('coach')).toBeVisible();
	await page.getByTestId('coach-dismiss').click();
	await expect(page.getByTestId('coach')).toBeHidden();

	await page.reload();
	await expect(page.getByTestId('coach')).toBeHidden();
});

test('Escape unwinds the drawer first, then edit mode', async ({ page }) => {
	await acceptGate(page);
	const main = page.getByRole('main');

	await page.getByTestId('open-drawer').click();
	await expect(page.getByTestId('add-drawer')).toBeVisible();

	// doc 13 §8: Esc closes the topmost layer, one at a time.
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('add-drawer')).toBeHidden();
	await expect(main).toHaveAttribute('data-edit', 'on');

	await page.keyboard.press('Escape');
	await expect(main).toHaveAttribute('data-edit', 'off');
});
