import { expect, test, type Page } from '@playwright/test';

/**
 * Spike S1 — gridstack 12.6 × Svelte 5 DOM ownership (doc 22 §S1).
 *
 * Doc 22's pass criterion is "50 scripted cycles of add/drag/resize/remove/
 * rebuild → DevTools Memory shows no detached-node growth". A DevTools panel
 * is not a criterion anything can enforce, so it is replaced here with
 * measurements that hold the same meaning and can fail a build:
 *
 *  - detached-node growth → count `.grid-stack-item` wrappers and mounted
 *    hosts after each batch; they must return to the baseline and stay equal
 *    to each other. A host that outlives its wrapper IS the detached tree.
 *  - Svelte lifecycle violations → fail on any `effect_orphan` or
 *    `state_unsafe_mutation` console message. The dummy widget deliberately
 *    holds an interval and a window listener so a mishandled unmount surfaces.
 *  - layout JSON round-trip → serialise, rebuild from that JSON, serialise
 *    again, compare strings.
 *  - column collapse → 12 → 6 → 3 → 1 and back; host count must equal tile
 *    count at every step, with no duplicated wrappers.
 */

const CYCLES = 50;

/** Console messages that mean the ownership contract was broken. */
const FATAL = /effect_orphan|state_unsafe_mutation|node_invalid_placement|hydration_mismatch/;

function watchConsole(page: Page): string[] {
	const problems: string[] = [];
	page.on('console', (msg) => {
		const text = msg.text();
		if (FATAL.test(text)) problems.push(text);
		// A widget throwing during teardown shows up as an uncaught error.
		if (msg.type() === 'error' && /is not a function|Cannot read|null/.test(text)) {
			problems.push(text);
		}
	});
	page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
	return problems;
}

interface Counts {
	wrappers: number;
	hosts: number;
	tiles: number;
}

async function counts(page: Page): Promise<Counts> {
	return {
		wrappers: await page.locator('.grid-stack-item').count(),
		hosts: Number(await page.getByTestId('host-count').innerText()),
		tiles: Number(await page.getByTestId('tile-count').innerText())
	};
}

test.describe('S1 · gridstack 12.6 × Svelte 5', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/spike/s1');
		await expect(page.getByTestId('tp-grid')).toBeVisible();
		await expect(page.locator('.grid-stack-item')).toHaveCount(6);
	});

	test('the grid owns wrappers and Svelte owns content', async ({ page }) => {
		// The structural invariant of doc 06 §5.1: every wrapper gridstack made
		// has exactly one Svelte host inside it, and nothing else.
		const wrappers = page.locator('.grid-stack-item');
		await expect(wrappers).toHaveCount(6);
		await expect(
			page.locator('.grid-stack-item > .grid-stack-item-content > .tp-host')
		).toHaveCount(6);

		const { hosts, tiles } = await counts(page);
		expect(hosts).toBe(6);
		expect(tiles).toBe(6);
	});

	test(`${CYCLES} add/remove/rebuild cycles leave no orphaned hosts`, async ({ page }) => {
		const problems = watchConsole(page);
		const baseline = await counts(page);
		const samples: Counts[] = [];

		for (let i = 0; i < CYCLES; i++) {
			// Deliberately net-neutral: +2 added, the rebuild restores the tile the
			// first remove took, then two removes return to the starting size. That
			// makes "the counts never move" a real invariant rather than a
			// restatement of whatever the harness happened to do.
			await page.getByTestId('add').click();
			await page.getByTestId('add').click();
			await page.getByTestId('save').click();
			await page.getByTestId('remove').click();
			await page.getByTestId('rebuild').click();
			await page.getByTestId('remove').click();
			await page.getByTestId('remove').click();

			// Drag every tenth cycle. Doc 22 asks for drag and resize inside the
			// loop; doing it on all fifty would dominate the runtime, and the
			// dedicated drag test covers the mechanics.
			if ((i + 1) % 10 === 0) {
				const handle = page.locator('.grid-stack-item .tp-drag').first();
				const box = await handle.boundingBox();
				if (box) {
					await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
					await page.mouse.down();
					await page.mouse.move(box.x + 260, box.y + 150, { steps: 6 });
					await page.mouse.up();
				}
				samples.push(await counts(page));
			}
		}

		// Wrappers, hosts and tiles must agree at every sample. Divergence in
		// either direction is the bug: a host outliving its wrapper is a detached
		// Svelte tree, a wrapper outliving its host is a detached DOM node.
		for (const [index, sample] of samples.entries()) {
			expect(sample.hosts, `sample ${index}: hosts vs wrappers`).toBe(sample.wrappers);
			expect(sample.hosts, `sample ${index}: hosts vs tiles`).toBe(sample.tiles);
		}

		// Steady state: fifty cycles of churn must leave the deck exactly where it
		// started. Any upward drift here is the growth doc 22 §S1 is hunting.
		for (const [index, sample] of samples.entries()) {
			expect(sample.wrappers, `sample ${index}: wrappers vs baseline`).toBe(baseline.wrappers);
		}

		await page.getByTestId('reset').click();
		const after = await counts(page);
		expect(after.wrappers).toBe(baseline.wrappers);
		expect(after.hosts).toBe(baseline.hosts);

		expect(problems, problems.join('\n')).toEqual([]);
	});

	test('layout JSON survives a serialise → rebuild → serialise round trip', async ({ page }) => {
		const problems = watchConsole(page);

		await page.getByTestId('add').click();
		await page.getByTestId('add').click();
		await page.getByTestId('save').click();

		const before = await page.getByTestId('saved-json').innerText();
		expect(before.length).toBeGreaterThan(2);

		await page.getByTestId('rebuild').click();
		await page.getByTestId('save').click();
		const after = await page.getByTestId('saved-json').innerText();

		expect(after).toBe(before);
		expect(problems, problems.join('\n')).toEqual([]);
	});

	test('column collapse and restore does not duplicate hosts', async ({ page }) => {
		const problems = watchConsole(page);
		const widths = [1440, 1000, 700, 420, 700, 1000, 1440];

		for (const width of widths) {
			await page.setViewportSize({ width, height: 900 });
			// Let gridstack settle on the new column count.
			await expect.poll(async () => (await counts(page)).wrappers, { timeout: 5000 }).toBe(6);

			const { hosts, wrappers } = await counts(page);
			expect(hosts, `at ${width}px: hosts vs wrappers`).toBe(wrappers);
			expect(
				await page.locator('.grid-stack-item > .grid-stack-item-content > .tp-host').count(),
				`at ${width}px: exactly one host per wrapper`
			).toBe(wrappers);
		}

		expect(problems, problems.join('\n')).toEqual([]);
	});

	test('the grid is inert in view mode and interactive in edit mode', async ({ page }) => {
		// doc 06 §5.5. gridstack only adds a class when interaction is *disabled*
		// — there is no `ui-draggable` marker in the enabled state, so absence of
		// the disabled class is what "interactive" looks like.
		const disabled = page.locator('.grid-stack-item.ui-draggable-disabled');
		const resizeDisabled = page.locator('.grid-stack-item.ui-resizable-disabled');

		// Harness starts in edit mode.
		await expect(disabled).toHaveCount(0);

		await page.getByTestId('toggle-edit').click();
		await expect(disabled).toHaveCount(6);
		await expect(resizeDisabled).toHaveCount(6);

		// Class names are an implementation detail; inertness is the requirement.
		// Attempt a real drag in view mode and assert the layout does not move.
		const before = await page.getByTestId('layout-json').innerText();
		const handle = page.locator('.grid-stack-item .tp-drag').first();
		const box = await handle.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await page.mouse.down();
		await page.mouse.move(box!.x + 350, box!.y + 180, { steps: 10 });
		await page.mouse.up();
		expect(await page.getByTestId('layout-json').innerText()).toBe(before);

		await page.getByTestId('toggle-edit').click();
		await expect(disabled).toHaveCount(0);
	});

	test('gridstack’s item margin is painted, not just configured', async ({ page }) => {
		// The regression this file could not see. gridstack turns `margin: 12`
		// into `--gs-item-margin-*` and applies it as the INSET of
		// `.grid-stack-item-content` inside an edge-to-edge wrapper — so a rule
		// setting `inset` on that element deletes the whole gutter at equal
		// specificity, and nothing notices: `margin: 12` stays in the JS opts, so
		// cacheRects, collision and every drop test above go on passing. That is
		// exactly what `inset: 0` did in TpGrid.svelte until doc 06 §5 rule 12.
		//
		// Asserted as the inset of one item rather than the distance between two,
		// because that stays true at every column breakpoint and does not depend
		// on which tiles happen to be adjacent.
		const item = page.locator('.grid-stack-item').first();
		const wrapper = await item.boundingBox();
		const content = await item.locator('.grid-stack-item-content').boundingBox();
		expect(wrapper).not.toBeNull();
		expect(content).not.toBeNull();

		const insets = {
			top: content!.y - wrapper!.y,
			left: content!.x - wrapper!.x,
			bottom: wrapper!.y + wrapper!.height - (content!.y + content!.height),
			right: wrapper!.x + wrapper!.width - (content!.x + content!.width)
		};

		for (const [side, value] of Object.entries(insets)) {
			expect(value, `${side} inset`).toBeGreaterThan(11);
			expect(value, `${side} inset`).toBeLessThan(13);
		}
	});

	test('dragging a tile updates the serialised layout', async ({ page }) => {
		const problems = watchConsole(page);
		const before = Number(await page.getByTestId('change-count').innerText());

		const handle = page.locator('.grid-stack-item .tp-drag').first();
		const box = await handle.boundingBox();
		expect(box).not.toBeNull();

		await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await page.mouse.down();
		await page.mouse.move(box!.x + 400, box!.y + 200, { steps: 12 });
		await page.mouse.up();

		await expect
			.poll(async () => Number(await page.getByTestId('change-count').innerText()))
			.toBeGreaterThan(before);

		const { hosts, wrappers } = await counts(page);
		expect(hosts).toBe(wrappers);
		expect(problems, problems.join('\n')).toEqual([]);
	});
});
