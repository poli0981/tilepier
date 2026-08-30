<script lang="ts">
	import { page } from '$app/state';
	import TpGrid from '$lib/core/grid/TpGrid.svelte';
	import type { TpLayout, TpTile } from '$lib/core/grid/layout';
	import DummyWidget from './DummyWidget.svelte';

	/**
	 * Spike S1 harness — doc 22 §S1.
	 *
	 * Everything here exists to be driven by e2e/s1-grid.e2e.ts. The controls
	 * are buttons rather than a script API so the harness exercises the same
	 * code path a user would, and the counters are rendered rather than logged
	 * so assertions read real state instead of console text.
	 */

	/**
	 * A registry id, mounting a stand-in component.
	 *
	 * The harness used `dummy` until 2026-08-31, which was fine while nothing
	 * about a tile came from its manifest. doc 06 §5 rule 14 changed that:
	 * `toGridStackWidget` now looks the widget up to emit `minW`/`minH`/`maxW`/
	 * `maxH`, and an id the registry has never heard of gets no bounds — so a
	 * `dummy` deck could not express the thing the clamp tests measure.
	 *
	 * `timer` because its manifest is the tightest registered: min 2×2,
	 * default 3×2, max 4×3. Both limits are one drag away from the arrangement
	 * below, so overshooting them is unambiguous rather than a 600 px flick.
	 * `DummyWidget` still supplies the content; `widgets` is a component map
	 * keyed by widget id, not the registry itself.
	 */
	const WIDGET_ID = 'timer';
	const widgets = { [WIDGET_ID]: DummyWidget };

	let seq = 0;
	function makeTile(index: number): TpTile {
		return {
			instanceId: `wgt_${index.toString(36).padStart(4, '0')}`,
			widgetId: WIDGET_ID,
			x: (index % 4) * 3,
			y: Math.floor(index / 4) * 2,
			w: 3,
			h: 2,
			settings: { label: `tile ${index}` }
		};
	}

	/**
	 * `?oob=1` seeds tile 0 at 1×1 — outside `timer`'s 2×2 minimum, and exactly
	 * the shape of a deck saved while rule 14's bounds were not wired up.
	 * `e2e/s1-grid` uses it to check gridstack clamps a stored size on the way
	 * in and that the clamped size is what `onLayoutChange` carries out, rather
	 * than the grid and `tp.layout.v1` quietly disagreeing.
	 *
	 * Only tile 0, so every other invariant in that file still reads the same
	 * six-tile arrangement it always has.
	 */
	const outOfBounds = page.url.searchParams.has('oob');

	const initial: TpTile[] = Array.from({ length: 6 }, (_, i) => {
		const seeded = makeTile(i);
		return outOfBounds && i === 0 ? { ...seeded, w: 1, h: 1 } : seeded;
	});
	seq = initial.length;

	let gridRef = $state<ReturnType<typeof TpGrid> | null>(null);
	let editMode = $state(true);
	let layout = $state<TpLayout>({ schemaVersion: 1, grid: [] });
	let changeCount = $state(0);
	let hostCount = $state(0);
	let savedJson = $state('');

	function onLayoutChange(next: TpLayout) {
		layout = next;
		changeCount += 1;
	}

	function add() {
		gridRef?.addTile(makeTile(seq++));
	}

	function removeLast() {
		const last = layout.grid.at(-1);
		if (last) gridRef?.removeTile(last.instanceId);
	}

	function save() {
		savedJson = JSON.stringify(gridRef?.snapshot() ?? null);
	}

	function rebuildFromSaved() {
		if (!savedJson) return;
		const parsed = JSON.parse(savedJson) as TpLayout;
		gridRef?.rebuild(parsed.grid);
	}

	function reset() {
		gridRef?.rebuild(Array.from({ length: 6 }, (_, i) => makeTile(i)));
		seq = 6;
	}
</script>

<svelte:head><title>Spike S1 — gridstack × Svelte 5</title></svelte:head>

<main>
	<h1>Spike S1 — gridstack 12.6 × Svelte 5</h1>

	<div class="controls">
		<button type="button" data-testid="add" onclick={add}>add</button>
		<button type="button" data-testid="remove" onclick={removeLast}>remove last</button>
		<button type="button" data-testid="save" onclick={save}>save</button>
		<button type="button" data-testid="rebuild" onclick={rebuildFromSaved}>rebuild</button>
		<button type="button" data-testid="reset" onclick={reset}>reset</button>
		<button type="button" data-testid="toggle-edit" onclick={() => (editMode = !editMode)}>
			edit: {editMode ? 'on' : 'off'}
		</button>
	</div>

	<dl class="readout tp-num">
		<div>
			<dt>tiles</dt>
			<dd data-testid="tile-count">{layout.grid.length}</dd>
		</div>
		<div>
			<dt>hosts</dt>
			<dd data-testid="host-count">{hostCount}</dd>
		</div>
		<div>
			<dt>changes</dt>
			<dd data-testid="change-count">{changeCount}</dd>
		</div>
	</dl>

	<output data-testid="layout-json" hidden>{JSON.stringify(layout)}</output>
	<output data-testid="saved-json" hidden>{savedJson}</output>

	<TpGrid
		bind:this={gridRef}
		tiles={initial}
		{widgets}
		{editMode}
		{onLayoutChange}
		onHostsChange={(n) => (hostCount = n)}
	/>
</main>

<style>
	main {
		max-width: 1680px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	h1 {
		margin: 0 0 1rem;
		font-size: var(--text-md);
		font-weight: 600;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.controls button {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		padding: 0.4rem 0.75rem;
		min-height: 40px;
		cursor: pointer;
	}

	.controls button:hover {
		border-color: var(--color-beacon);
	}

	.readout {
		display: flex;
		gap: 1.5rem;
		margin: 0 0 1rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.readout div {
		display: flex;
		gap: 0.4rem;
	}

	.readout dt,
	.readout dd {
		margin: 0;
	}

	.readout dd {
		color: var(--color-beacon);
	}
</style>
