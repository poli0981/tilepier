<script lang="ts">
	import { listByCategory, type TpWidgetManifest } from '$lib/core/registry';
	import type { TpWidgetId } from '$lib/core/types';
	import { foldForSearch } from '$lib/i18n/fold';
	import { widgetLabels } from '$lib/i18n/widget-labels';
	import { m } from '$lib/paraglide/messages';
	import { deck } from '$lib/stores/deck.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';

	/**
	 * doc 13 §4. Right-side sheet, bottom sheet under 768 px. Cards grouped by
	 * category with icon, name, one-line description, a size-footprint glyph,
	 * and an Add button; single-instance widgets already on the deck show a
	 * disabled "on deck" state rather than a button that quietly does nothing.
	 */
	interface Props {
		onAdd: (widgetId: TpWidgetId) => void;
	}

	let { onAdd }: Props = $props();

	let query = $state('');
	let panelEl = $state<HTMLElement | null>(null);
	let trigger: Element | null = null;

	const groups = $derived(
		listByCategory()
			.map((group) => ({
				category: group.category,
				items: group.items.filter((manifest) => matches(manifest, query))
			}))
			.filter((group) => group.items.length > 0)
	);

	/** doc 13 §4: search filters by name, with diacritics folded. */
	function matches(manifest: TpWidgetManifest, q: string): boolean {
		if (q.trim() === '') return true;
		const title = widgetLabels(manifest.id)?.title() ?? manifest.id;
		return foldForSearch(title).includes(foldForSearch(q.trim()));
	}

	function onDeck(manifest: TpWidgetManifest): boolean {
		return !manifest.multiInstance && deck.widgetIds.includes(manifest.id);
	}

	$effect(() => {
		if (!ui.drawerOpen) return;

		// Return focus where it came from when the sheet closes (doc 13 §8).
		trigger = document.activeElement;
		panelEl?.focus();

		return () => {
			if (trigger instanceof HTMLElement) trigger.focus();
			query = '';
		};
	});
</script>

{#if ui.drawerOpen}
	<!-- The scrim closes on click; Esc is handled globally in the layout so the
	     drawer and edit mode unwind in the documented order. -->
	<div
		class="tp-drawer__scrim"
		role="presentation"
		onclick={() => ui.closeDrawer()}
		data-testid="drawer-scrim"
	></div>

	<div
		class="tp-drawer"
		role="dialog"
		aria-modal="true"
		aria-label={m['common.add_widget']()}
		tabindex="-1"
		bind:this={panelEl}
		data-testid="add-drawer"
	>
		<header>
			<h2>{m['common.add_widget']()}</h2>
			<button
				type="button"
				class="tp-drawer__close"
				aria-label={m['common.dismiss']()}
				onclick={() => ui.closeDrawer()}
			>
				<TpIcon name="close" size={18} />
			</button>
		</header>

		<label class="tp-drawer__search">
			<TpIcon name="search" size={16} />
			<input type="search" bind:value={query} placeholder={m['common.search']()} />
		</label>

		{#if groups.length === 0}
			<p class="tp-drawer__empty">{m['common.no_matches']()}</p>
		{/if}

		{#each groups as group (group.category)}
			<section>
				<h3>{m[`common.category.${group.category}`]()}</h3>
				{#each group.items as manifest (manifest.id)}
					{@const labels = widgetLabels(manifest.id)}
					{@const taken = onDeck(manifest)}
					<article class="tp-card">
						<TpIcon name={manifest.icon} size={20} />
						<div class="tp-card__text">
							<p class="tp-card__title">{labels?.title() ?? manifest.id}</p>
							<p class="tp-card__blurb">{labels?.blurb() ?? ''}</p>
						</div>

						<!-- Size-footprint glyph: the default size against 12 columns. -->
						<span
							class="tp-card__footprint tp-num"
							title="{manifest.sizes.default.w}×{manifest.sizes.default.h}"
							aria-hidden="true"
						>
							{manifest.sizes.default.w}×{manifest.sizes.default.h}
						</span>

						<button
							type="button"
							class="tp-card__add"
							disabled={taken}
							data-testid="add-{manifest.id}"
							onclick={() => onAdd(manifest.id)}
						>
							{taken ? m['common.on_deck']() : m['common.add']()}
						</button>
					</article>
				{/each}
			</section>
		{/each}
	</div>
{/if}

<style>
	.tp-drawer__scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: color-mix(in oklch, var(--color-ink-950) 80%, transparent);
	}

	.tp-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 61;
		width: min(24rem, 100vw);
		overflow-y: auto;
		border-left: 1px solid var(--color-ink-700);
		background: var(--color-ink-850);
		padding: 1rem;
	}

	/* doc 13 §4: a bottom sheet on narrow screens. */
	@media (max-width: 767px) {
		.tp-drawer {
			top: auto;
			left: 0;
			width: auto;
			max-height: 75dvh;
			border-left: 0;
			border-top: 1px solid var(--color-ink-700);
			border-radius: var(--radius-tile) var(--radius-tile) 0 0;
		}
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	h2 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
	}

	h3 {
		margin: 1rem 0 0.5rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		font-weight: 500;
		text-transform: lowercase;
	}

	.tp-drawer__close {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 40px;
		min-height: 40px;
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
	}

	.tp-drawer__search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		padding: 0 0.625rem;
		color: var(--color-fg-dim);
	}

	.tp-drawer__search input {
		flex: 1 1 auto;
		border: 0;
		background: none;
		color: var(--color-fg);
		font: inherit;
		min-height: 40px;
		outline: none;
	}

	.tp-drawer__empty {
		margin: 1.5rem 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-card {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		padding: 0.625rem 0.75rem;
		margin-bottom: 0.5rem;
		color: var(--color-fg-mute);
	}

	.tp-card__text {
		flex: 1 1 auto;
		min-width: 0;
	}

	.tp-card__title {
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.tp-card__blurb {
		margin: 0;
		font-size: var(--text-2xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-card__footprint {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-card__add {
		flex: none;
		border: 1px solid var(--color-beacon);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 32px;
		padding: 0 0.625rem;
	}

	.tp-card__add:hover:not(:disabled) {
		background: var(--color-beacon-soft);
	}

	.tp-card__add:disabled {
		border-color: var(--color-ink-700);
		color: var(--color-fg-dim);
		cursor: default;
	}
</style>
