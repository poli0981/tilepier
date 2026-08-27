<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { pushState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { isDetailState, type TpDetailState } from '$lib/core/detail';
	import type TpGridType from '$lib/core/grid/TpGrid.svelte';
	import type { TpLayout } from '$lib/core/grid/layout';
	import { getManifest } from '$lib/core/registry';
	import { isWidgetId, type TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import { deck } from '$lib/stores/deck.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import TpDetailOverlay from '$lib/ui/TpDetailOverlay.svelte';

	/**
	 * The deck (doc 03 §Rendering). The page is prerendered, but nothing renders
	 * here until the layout has been read from client storage — the server emits
	 * an empty deck area on purpose, so there is nothing to flash.
	 *
	 * **TpGrid is imported dynamically, and has to be** (doc 06 §5 rule 10).
	 * gridstack's ESM build uses extensionless relative imports; bundlers
	 * resolve those and Node's ESM resolver does not, so a static import fails
	 * the prerender of `/`. Loading it on the client is right anyway — a DOM
	 * library has nothing to contribute to a server render, and this keeps it
	 * out of the entry chunk.
	 */
	let TpGrid = $state<typeof TpGridType | null>(null);
	let gridRef = $state<ReturnType<typeof TpGridType> | null>(null);
	let components = $state<Record<string, Component<TpWidgetProps>> | null>(null);

	$effect(() => {
		// Loads the grid and exactly the widget chunks this deck needs, before
		// either is rendered. This is the lazy-loading boundary: the entry chunk
		// carries manifests, components arrive per widget (doc 06 §1).
		if (!deck.loaded) return;

		let cancelled = false;
		const ids = [...new Set(deck.widgetIds)];

		void Promise.all([
			import('$lib/core/grid/TpGrid.svelte'),
			Promise.all(
				ids.map(async (id) => {
					const manifest = getManifest(id);
					if (manifest === undefined) return null;
					return [id, (await manifest.loadWidget()).default] as const;
				})
			)
		]).then(([grid, loaded]) => {
			if (cancelled) return;
			components = Object.fromEntries(loaded.filter((entry) => entry !== null));
			TpGrid = grid.default;
		});

		return () => {
			cancelled = true;
		};
	});

	/**
	 * Reconciles the grid against the store.
	 *
	 * doc 06 §5 rule 9: `tiles` is a seed the grid reads once, so a tile the
	 * drawer adds never arrives through the prop. Something has to carry it,
	 * and a diff here beats an event channel from the layout — this is also the
	 * one place that has to stay right when import or reset replaces the whole
	 * deck at once.
	 *
	 * `synced` is a plain binding, not state: writing it must not re-trigger.
	 */
	let synced: Set<string> | null = null;

	$effect(() => {
		const grid = gridRef;
		const tiles = deck.tiles;
		if (grid === null) return;

		untrack(() => {
			if (synced === null) {
				// TpGrid mounted the seed itself from the prop; adopt it.
				synced = new Set(tiles.map((tile) => tile.instanceId));
				return;
			}

			const next = new Set(tiles.map((tile) => tile.instanceId));
			for (const tile of tiles) {
				if (!synced.has(tile.instanceId)) grid.addTile(tile);
			}
			for (const id of synced) {
				if (!next.has(id)) grid.removeTile(id);
			}
			synced = next;
		});
	});

	function onLayoutChange(layout: TpLayout): void {
		deck.applyLayout(layout);
	}

	function onRemove(instanceId: string): void {
		// doc 06 §4: removing a tile never deletes the underlying data, so there
		// is nothing to confirm. The reconcile effect takes it off the grid.
		deck.remove(instanceId);
	}

	function onUpdateSettings(instanceId: string, partial: Record<string, unknown>): void {
		deck.updateSettings(instanceId, partial);
	}

	/**
	 * Opening a detail is a history push, not a local flag (doc 06 §6). The
	 * overlay below renders off `page.state`, so the browser's Back button
	 * closes it without a popstate handler of ours racing SvelteKit's.
	 *
	 * The tile rect is measured *before* the push, because the panel that will
	 * fly out of it has to know where it started (doc 13 §5.1).
	 */
	function onOpenDetail(instanceId: string): void {
		const tile = deck.tiles.find((entry) => entry.instanceId === instanceId);
		if (tile === undefined || !isWidgetId(tile.widgetId)) return;

		// A widget with no detail has nothing to open, and doc 06 §1 makes that a
		// legitimate manifest. Better that the tile simply does not respond than
		// that an empty panel flies out of it.
		if (getManifest(tile.widgetId)?.loadDetail === undefined) return;

		const rect = gridRef?.tileRect(instanceId) ?? null;
		const detail: TpDetailState = {
			instanceId,
			widgetId: tile.widgetId,
			// exactOptionalPropertyTypes (doc 20 §2): omit the field, never set it
			// to undefined — and history.state has to survive a structured clone,
			// which a DOMRect does not reliably do.
			...(rect === null
				? {}
				: { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
		};

		// `/(app)/w/[id]` rather than `/w/[id]`: SvelteKit's generated RouteId
		// union spells a grouped route with its group, even though the group never
		// appears in the URL resolve() returns. Writing the plain path compiles to
		// "Expected 1 arguments, but got 2", because the id is then not a known
		// parameterised route.
		//
		// The path *is* resolved; the rule's heuristic cannot see resolve() through
		// a template literal, and the query is what carries the instance. Same
		// shape, and same reason, as the gate's `?lang=` links in +layout.svelte.
		const url = `${resolve('/(app)/w/[id]', { id: tile.widgetId })}?i=${encodeURIComponent(instanceId)}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		pushState(url, { detail });
	}

	/** Narrowed rather than trusted: `page.state` is restored verbatim from a
	 *  history entry a previous build may have written (core/detail.ts). */
	const detailTarget = $derived(isDetailState(page.state.detail) ? page.state.detail : null);
</script>

<svelte:head>
	<title>TilePier</title>
	<meta name="description" content={m['common.deck.description']()} />
</svelte:head>

<main data-edit={ui.editMode ? 'on' : 'off'}>
	{#if deck.loaded && deck.tiles.length === 0}
		<p class="tp-deck__empty">{m['common.deck.empty']()}</p>
	{:else if TpGrid !== null && components !== null}
		<TpGrid
			bind:this={gridRef}
			tiles={deck.tiles}
			widgets={components}
			editMode={ui.editMode}
			{onLayoutChange}
			{onOpenDetail}
			{onRemove}
			{onUpdateSettings}
		/>
	{/if}
</main>

{#if detailTarget !== null}
	<!--
		Closing pops the entry this page pushed, which is what makes ×, Esc, the
		scrim and Back all take the same route out. `rectOf` re-measures on the way
		back down because the grid may have reflowed while the panel was open
		(doc 13 §5.3).
	-->
	<TpDetailOverlay
		detail={detailTarget}
		rectOf={(instanceId) => gridRef?.tileRect(instanceId) ?? null}
		onClose={() => history.back()}
	/>
{/if}

<style>
	main {
		max-width: 1680px;
		margin: 0 auto;
		padding: var(--tp-page-pad, 16px);
		min-height: calc(100dvh - var(--tp-bar-h, 48px));
	}

	@media (min-width: 768px) {
		main {
			padding: 24px;
		}
	}

	/* doc 13 §2: edit mode shows a faint dot lattice behind the grid. */
	main[data-edit='on'] {
		background-image: radial-gradient(var(--color-ink-700) 1px, transparent 1px);
		background-size: 24px 24px;
	}

	.tp-deck__empty {
		margin: 4rem 0 0;
		color: var(--color-fg-mute);
		font-size: var(--text-base);
	}
</style>
