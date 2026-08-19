<script lang="ts">
	import type { Component } from 'svelte';
	import type TpGridType from '$lib/core/grid/TpGrid.svelte';
	import type { TpLayout } from '$lib/core/grid/layout';
	import { getManifest } from '$lib/core/registry';
	import type { TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import { deck } from '$lib/stores/deck.svelte';

	/**
	 * The deck (doc 03 §Rendering). The page is prerendered, but nothing renders
	 * here until the layout has been read from client storage — the server emits
	 * an empty deck area on purpose, so there is nothing to flash.
	 *
	 * **TpGrid is imported dynamically, and has to be.** It pulls in gridstack,
	 * whose ESM build uses extensionless relative imports; bundlers accept those
	 * and Node's ESM resolver does not, so a static import fails the prerender
	 * of `/` with ERR_MODULE_NOT_FOUND. `ssr = false` would also "fix" it and is
	 * ruled out by doc 03 — it strips the legal gate out of the HTML. Loading it
	 * on the client is the honest answer anyway: gridstack is a DOM library with
	 * nothing to contribute to a server render, and this keeps it out of the
	 * entry chunk.
	 *
	 * The top bar, the add-widget drawer and the edit-mode chrome arrive with
	 * doc 13 §1–§4. What exists now is the keyboard half of doc 13 §8, which is
	 * enough to arrange a deck and prove it persists.
	 */
	let TpGrid = $state<typeof TpGridType | null>(null);
	let gridRef = $state<ReturnType<typeof TpGridType> | null>(null);
	let components = $state<Record<string, Component<TpWidgetProps>> | null>(null);
	let editMode = $state(false);

	$effect(() => {
		// Synchronises the store with localStorage once, on mount.
		deck.hydrate();
	});

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

	function onLayoutChange(layout: TpLayout): void {
		deck.applyLayout(layout);
	}

	// doc 13 §8: `e` toggles edit, Esc closes the topmost layer. The visible
	// affordances for both land with the top bar.
	function onKeydown(event: KeyboardEvent): void {
		const target = event.target;
		// Never steal a keystroke from something the user is typing into.
		if (target instanceof HTMLElement && target.isContentEditable) return;
		if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

		if (event.key === 'e' && !event.metaKey && !event.ctrlKey && !event.altKey) {
			editMode = !editMode;
		} else if (event.key === 'Escape') {
			editMode = false;
		}
	}
</script>

<svelte:head>
	<title>TilePier</title>
	<meta name="description" content={m['common.deck.description']()} />
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<main data-edit={editMode ? 'on' : 'off'}>
	{#if deck.loaded && deck.tiles.length === 0}
		<p class="tp-deck__empty">{m['common.deck.empty']()}</p>
	{:else if TpGrid !== null && components !== null}
		<TpGrid
			bind:this={gridRef}
			tiles={deck.tiles}
			widgets={components}
			{editMode}
			{onLayoutChange}
		/>
	{/if}
</main>

<style>
	main {
		max-width: 1680px;
		margin: 0 auto;
		padding: var(--tp-page-pad, 16px);
		min-height: 100dvh;
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
