import { expect, test, type Page } from '@playwright/test';
import { acceptGate } from './_lib/gate';
import { LAUNCH_ARGS } from './_lib/launch';

/**
 * Scrollbars as a reader on Windows sees them (doc 06 §5.4, doc 19 §4).
 *
 * Every other spec runs with no scrollbars at all. Playwright launches headless
 * Chromium with `--hide-scrollbars`, in this suite and in Vitest's browser mode
 * alike, so a classic scrollbar — the kind that takes layout width — had never
 * been on screen in a test until this file. It drops that one flag and is
 * therefore the only place a scrollbar's width can break a layout.
 *
 * `test.use({ launchOptions })` replaces the config's launch options whole,
 * which is why the shared arguments are restated (`e2e/_lib/launch.ts`).
 */
test.use({ launchOptions: { args: LAUNCH_ARGS, ignoreDefaultArgs: ['--hide-scrollbars'] } });

/**
 * A classic scrollbar's width in this browser, from a probe forced to scroll;
 * 0 means overlay scrollbars, which take no width and so cannot break anything
 * this file checks. The probe gets the page's own scrollbar rules, so it
 * measures what the root draws.
 *
 * CI runs Linux, whose headless Chromium draws classic scrollbars once the flag
 * is gone. A 0 there would mean the flag had not been dropped, and every test
 * here would pass while testing nothing, so CI fails instead of skipping.
 */
async function classicScrollbarWidth(page: Page): Promise<number> {
	const width = await page.evaluate(() => {
		const probe = document.createElement('div');
		probe.style.cssText =
			'position:absolute;top:-200px;width:100px;height:100px;overflow:scroll;visibility:hidden';
		document.body.appendChild(probe);
		const measured = probe.offsetWidth - probe.clientWidth;
		probe.remove();
		return measured;
	});
	if (process.env.CI) expect(width, 'classic scrollbars on CI').toBeGreaterThan(0);
	else test.skip(width === 0, 'this machine draws overlay scrollbars, which take no width');
	return width;
}

async function overflows(page: Page): Promise<boolean> {
	return page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
}

/** The column count gridstack is using, from the `gs-N` class it maintains. */
async function columns(page: Page): Promise<number> {
	const names = (await page.locator('.grid-stack').getAttribute('class')) ?? '';
	return Number(/\bgs-(\d+)\b/.exec(names)?.[1] ?? Number.NaN);
}

async function gridWidth(page: Page): Promise<number> {
	return page.locator('.grid-stack').evaluate((grid) => grid.clientWidth);
}

test('entering edit mode leaves the column count alone (doc 06 §5.4)', async ({ page }) => {
	// Tall enough that the seeded deck fits at any column count: the page
	// must not scroll until edit mode adds its strip.
	await page.setViewportSize({ width: 1600, height: 1400 });
	await acceptGate(page, { dismissCoach: true });
	await expect(page.locator('.grid-stack-item').first()).toBeVisible();
	const scrollbar = await classicScrollbarWidth(page);

	// Everything around the grid at this width — the page padding — measured
	// rather than restated, inside whatever the root reserves for a scrollbar.
	const chrome = await page.evaluate(() => {
		const grid = document.querySelector('.grid-stack');
		if (!(grid instanceof HTMLElement)) throw new Error('no grid');
		return document.documentElement.clientWidth - grid.clientWidth;
	});

	// The width at which a scrollbar decides the column count: without one the
	// grid is just over doc 06 §5.4's 1280 px breakpoint (12 columns); with one
	// it is at or under it (6). gridstack compares `width <= breakpoint`.
	const width = 1280 + chrome + Math.ceil(scrollbar / 2);
	await page.setViewportSize({ width, height: 1400 });
	// Reloaded at the new size, so the grid mounts there rather than
	// recalculating under the test (the lesson recorded in e2e/s1-grid).
	await page.reload();
	await expect(page.locator('.grid-stack-item').first()).toBeVisible();
	expect(await overflows(page), 'the deck fits before edit mode').toBe(false);

	const before = await columns(page);
	const widthBefore = await gridWidth(page);
	await page.evaluate(() => {
		const grid = document.querySelector('.grid-stack');
		if (!(grid instanceof HTMLElement)) throw new Error('no grid');
		const seen: string[] = [];
		(window as unknown as { tpColumnsSeen: string[] }).tpColumnsSeen = seen;
		new MutationObserver(() => {
			seen.push(/\bgs-(\d+)\b/.exec(grid.className)?.[1] ?? '?');
		}).observe(grid, { attributes: true, attributeFilter: ['class'] });
	});

	await page.keyboard.press('e');
	await expect(page.getByTestId('edit-strip')).toBeVisible();
	// The strip sits in flow under a `main` that already fills the viewport, so
	// any deck scrolls in edit mode — the scrollbar this test is about.
	expect(await overflows(page), 'edit mode makes the page scroll').toBe(true);

	// gridstack's ResizeObserver is throttled; give it time to act if it is
	// going to. A count that changed and changed back is caught by `seen`.
	await page.waitForTimeout(600);
	expect(await columns(page)).toBe(before);
	expect(await gridWidth(page)).toBe(widthBefore);
	const seen = await page.evaluate(
		() => (window as unknown as { tpColumnsSeen: string[] }).tpColumnsSeen
	);
	expect(new Set(seen.filter((value) => value !== String(before)))).toEqual(new Set());
});

test('a detail shown as a full-screen sheet stays clear of the scrollbar (doc 13 §6)', async ({
	page
}) => {
	await page.setViewportSize({ width: 600, height: 500 });
	await acceptGate(page, { dismissCoach: true });
	await classicScrollbarWidth(page);
	// The deck behind must scroll, or there is no scrollbar to slide under —
	// polled, because the grid mounts after the gate's `main` is visible.
	await expect.poll(() => overflows(page), { message: 'the deck scrolls' }).toBe(true);

	await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
	const panel = page.getByTestId('detail-panel');
	await expect(panel).toBeVisible();
	// The panel grows out of the tile (doc 13 §5); measure where it settles,
	// not a frame of the transform on the way there.
	await panel.evaluate((element) =>
		Promise.all(element.getAnimations().map((animation) => animation.finished))
	);

	const right = await panel.evaluate((element) => element.getBoundingClientRect().right);
	const visible = await page.evaluate(() => document.documentElement.clientWidth);
	expect(right, 'the sheet ends where the page content does').toBeLessThanOrEqual(visible);

	await page.getByTestId('detail-close').click();
	await expect(panel).toBeHidden();
});
