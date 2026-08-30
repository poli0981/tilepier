import { expect, test, type Locator, type Page } from '@playwright/test';

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

/**
 * The harness's tiles are `timer` — min 2×2, default 3×2, max 4×3 in doc 06 §7,
 * and the tightest manifest registered, so a drag that overshoots either limit
 * does so unambiguously. The numbers are written out rather than
 * imported because an e2e file that read the manifest would agree with itself
 * whatever the manifest said.
 */
const BOUNDS = { min: { w: 2, h: 2 }, max: { w: 4, h: 3 } };

/**
 * The size the *serialised layout* reports for a tile — that is, what came out
 * through `onLayoutChange`, not what the DOM happens to show. The two agreeing
 * is the thing worth asserting; a clamp gridstack applies and never reports is
 * exactly the divergence doc 06 §5 rules 13 and 14 are about.
 */
async function serialisedSize(page: Page, instanceId: string): Promise<{ w: number; h: number }> {
	const raw = await page.getByTestId('layout-json').innerText();
	const layout = JSON.parse(raw) as { grid: { instanceId: string; w: number; h: number }[] };
	const tile = layout.grid.find((t) => t.instanceId === instanceId);
	return { w: tile?.w ?? -1, h: tile?.h ?? -1 };
}

/**
 * Drags an item's south-east resize handle to an absolute page point.
 *
 * Revealing that handle takes a real mouseout → mouseover **pair**, and a
 * single move onto the tile is not enough. gridstack keeps
 * `ui-resizable-autohide` on an unhovered item and its own stylesheet gives the
 * handles `display: none` under it, so the element exists with no box at all
 * until the pointer is over the tile. `DDResizable._mouseOver` then returns
 * early while `DDManager.overResizeElement` is set, and `_mouseOut` clears that
 * only when it points at the item being left — so a pointer sitting inside a
 * tile whose drag-and-drop was re-initialised under it leaves the manager
 * holding a stale element, and no handle on any tile appears again.
 *
 * Hence the corner first, then the tile, and hence polled: the pair has to be
 * re-sent rather than merely re-checked, which no `toBeVisible()` retry does.
 * Found on CI, where a second resize in the same test could not start.
 */
async function resizeTo(page: Page, item: Locator, x: number, y: number): Promise<void> {
	const box = await item.boundingBox();
	expect(box, 'grid item').not.toBeNull();
	const handle = item.locator('.ui-resizable-se');

	await expect
		.poll(
			async () => {
				await page.mouse.move(0, 0);
				await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
				return handle.isVisible();
			},
			{ message: 'south-east resize handle revealed' }
		)
		.toBe(true);

	const grip = await handle.boundingBox();
	expect(grip, 'south-east resize handle box').not.toBeNull();

	await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
	await page.mouse.down();
	await page.mouse.move(x, y, { steps: 12 });
	await page.mouse.up();
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

	test.describe('manifest size bounds (doc 06 §5 rule 14)', () => {
		/*
		 * `toGridStackWidget` returned `{id, x, y, w, h}` and nothing else until
		 * 2026-08-31, so every manifest's `sizes.min` and `sizes.max` was enforced
		 * nowhere: any tile drag-resized to 1×1, which paints 112×48 px with rule
		 * 12's inset honoured and which no widget has a rendering for.
		 * `core/registry.test` asserted the numbers matched doc 06 §7's table;
		 * nothing asserted they were applied.
		 *
		 * **The viewport is 1440 and is declared, not set.** Playwright's default
		 * 1280 leaves the grid element at about 1232 px, which is doc 06 §5.4's
		 * `{w: 1280, c: 6}` breakpoint — a six-column grid. `engine.save()` then
		 * reports the cached twelve-column layout in preference to the live nodes,
		 * so a drag shows on screen and not in the serialised layout at all, and
		 * the test fails saying the clamp did not happen when what did not happen
		 * was the measurement. Declaring it through `test.use` rather than calling
		 * `setViewportSize()` mid-test matters just as much: a resize *after* the
		 * grid has mounted kicks off a column recalculation that moves every tile,
		 * and a `boundingBox()` read before that settles points the pointer at
		 * where a tile used to be. Locally it settles first; on CI it does not.
		 * 1440 also gives the 4×3 maximum room to be overshot downwards without
		 * the pointer leaving the viewport.
		 *
		 * One drag per test, each from a freshly loaded grid, rather than shrink
		 * and grow in sequence. Two resizes in a row leave
		 * `DDManager.overResizeElement` pointing at an element whose handlers were
		 * re-initialised under the pointer, and the second drag cannot start — see
		 * `resizeTo`. The two limits are independent claims anyway.
		 *
		 * **The two drag tests assert `gs-w`/`gs-h` on the item; only the load
		 * test asserts the serialised layout.** That split is deliberate, and it
		 * is a limit of driving gridstack through injected input rather than a
		 * preference. Measured at two runs in eight: the tile ends the clamped
		 * size on screen and its `gs-w` says so, while `onLayoutChange` has fired
		 * exactly once for the whole test — the mount emit — so gridstack
		 * produced no `change` for the resize at all. Ending the gesture inside
		 * the tile rather than at its corner did not help, and adding settling
		 * moves before the release made it worse, so the cause is not understood
		 * and is not claimed here. **Whether a real pointer can lose a resize the
		 * same way is an open question worth answering separately** — if it can,
		 * a user's resize silently fails to persist, which no amount of test
		 * arrangement would fix. Cells rather than pixels either way, because
		 * pixels depend on the column count and cells do not.
		 */
		test.use({ viewport: { width: 1440, height: 1000 } });

		test('a resize is clamped to the manifest’s minimum', async ({ page }) => {
			const problems = watchConsole(page);

			const item = page.locator('.grid-stack-item').first();

			// Drag the handle to the tile's own top-left: three columns and two rows
			// of travel against a floor two of each away.
			const box = await item.boundingBox();
			expect(box).not.toBeNull();
			await resizeTo(page, item, box!.x + 2, box!.y + 2);

			await expect(item, 'clamped to min').toHaveAttribute('gs-w', String(BOUNDS.min.w));
			await expect(item, 'clamped to min').toHaveAttribute('gs-h', String(BOUNDS.min.h));
			expect(problems, problems.join('\n')).toEqual([]);
		});

		test('a resize is clamped to the manifest’s maximum', async ({ page }) => {
			const problems = watchConsole(page);

			const item = page.locator('.grid-stack-item').first();

			const box = await item.boundingBox();
			expect(box).not.toBeNull();
			await resizeTo(page, item, box!.x + 900, box!.y + 620);

			await expect(item, 'clamped to max').toHaveAttribute('gs-w', String(BOUNDS.max.w));
			await expect(item, 'clamped to max').toHaveAttribute('gs-h', String(BOUNDS.max.h));
			expect(problems, problems.join('\n')).toEqual([]);
		});

		test('a stored size outside the bounds is clamped on load and written back', async ({
			page
		}) => {
			// The other half of rule 14, and the half that decides whether the fix is
			// a repair or a second bug: a deck saved at 1×1 while the bounds were not
			// wired up still exists. gridstack clamps it in `engine.nodeBoundFix` on
			// the way through `addWidget` — but `_triggerAddEvent` clears the dirty
			// flag before `change` would carry it, so an added node never reports its
			// own clamp. Rule 13's single post-loop emit is what carries it instead,
			// and without that the grid would render 2×2 while `tp.layout.v1` kept the
			// 1×1 for good.
			//
			// So this asserts both sides: what the DOM shows and what came out
			// through `onLayoutChange`, which is what the deck store persists. It
			// carries the serialisation claim for all three tests — no gesture is
			// involved, so the emit is not subject to the flake described above,
			// and this is the test that caught `serialise()` reading an omitted
			// `w` as the stored size rather than as the minimum.
			const problems = watchConsole(page);

			await page.goto('/spike/s1?oob=1');
			await expect(page.getByTestId('tp-grid')).toBeVisible();
			await expect(page.locator('.grid-stack-item')).toHaveCount(6);

			const item = page.locator('.grid-stack-item').first();
			await expect(item).toHaveAttribute('gs-id', 'wgt_0000');
			await expect(item).toHaveAttribute('gs-w', String(BOUNDS.min.w));
			await expect(item).toHaveAttribute('gs-h', String(BOUNDS.min.h));

			await expect
				.poll(async () => serialisedSize(page, 'wgt_0000'), { message: 'emitted layout' })
				.toEqual(BOUNDS.min);

			expect(problems, problems.join('\n')).toEqual([]);
		});
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
