<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import type { Component } from 'svelte';
	import { loadDetailComponent } from '$lib/core/detail';
	import { getManifest } from '$lib/core/registry';
	import { isWidgetId, type TpDetailProps } from '$lib/core/types';
	import { widgetLabels } from '$lib/i18n/widget-labels';
	import { m } from '$lib/paraglide/messages';
	import { deck } from '$lib/stores/deck.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';

	/**
	 * Direct navigation to a detail (doc 13 §5.4): full-screen, no animation,
	 * "◂ back to the deck", and — when the widget is not on the deck at all —
	 * an offer to pin it, because the alternative is a page that can show
	 * nothing and explain nothing.
	 *
	 * There is no overlay here and no `pushState`. The overlay is the deck's
	 * affordance; this route is the same detail component standing on its own,
	 * which is the whole point of doc 06 §6 having two entry points.
	 */
	const widgetId = $derived(isWidgetId(page.params['id']) ? page.params['id'] : null);
	const manifest = $derived(widgetId === null ? undefined : getManifest(widgetId));

	/**
	 * Read from `location`, not `page.url`: this route is prerendered, and
	 * SvelteKit refuses `url.searchParams` there — a prerendered page has no
	 * query string to read. `browser` is a build-time constant, so the branch
	 * compiles out of the server bundle rather than being guarded at runtime.
	 * `TpSettingsPanel` reads `?debug=1` the same way, for the same reason.
	 */
	const requested = $derived(browser ? new URLSearchParams(location.search).get('i') : null);

	/**
	 * The instance to render. The `?i=` one when it is still on the deck,
	 * otherwise the first tile of this widget — a link shared between two
	 * browsers carries an instance id the other one has never seen, and falling
	 * back beats an error page for what is, to the reader, the same widget.
	 */
	const tile = $derived(
		deck.tiles.find((entry) => entry.instanceId === requested) ??
			deck.tiles.find((entry) => entry.widgetId === widgetId)
	);

	let component = $state<Component<TpDetailProps> | null>(null);
	let failed = $state(false);

	$effect(() => {
		// Loads the detail chunk for this route. Code, not data — doc 20 §3's ban
		// is on fetching data in an effect.
		if (widgetId === null || manifest?.loadDetail === undefined) return;

		let cancelled = false;
		loadDetailComponent(widgetId)
			.then((loaded) => {
				if (!cancelled) component = loaded;
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});

		return () => {
			cancelled = true;
		};
	});

	function pin(): void {
		if (widgetId === null) return;
		// doc 13 §5.4. `add` returns null for a single-instance widget already on
		// the deck, which cannot happen here — `tile` would have found it.
		deck.add(widgetId);
	}

	function onUpdateSettings(partial: Record<string, unknown>): void {
		if (tile !== undefined) deck.updateSettings(tile.instanceId, partial);
	}

	const title = $derived(widgetId === null ? null : (widgetLabels(widgetId)?.title() ?? widgetId));
</script>

<svelte:head>
	<title>{title ?? 'TilePier'}</title>
</svelte:head>

<main class="tp-w">
	<header>
		<a class="tp-w__back" href={resolve('/')}>{m['common.back_to_deck']()}</a>
		{#if title !== null}
			<h1>{title}</h1>
		{/if}
	</header>

	{#if manifest === undefined}
		<!-- Unknown id, or a widget this build does not have yet. Not a 404: the
		     route exists, the widget is what is missing. -->
		<p class="tp-w__state" role="alert">{m['common.detail.unknown']()}</p>
	{:else if manifest.loadDetail === undefined}
		<p class="tp-w__state">{m['common.detail.none']()}</p>
	{:else if failed}
		<p class="tp-w__state" role="alert">{m['common.detail.failed']()}</p>
	{:else if tile === undefined}
		<!-- doc 13 §5.4: not on the deck, so offer to put it there. -->
		<div class="tp-w__state">
			<TpTideGauge size={48} level={0.2} />
			<p>{m['common.detail.pin_note']()}</p>
			<button type="button" class="tp-w__pin" data-testid="pin-to-deck" onclick={pin}>
				{m['common.detail.pin']()}
			</button>
		</div>
	{:else if component !== null}
		{@const Detail = component}
		<div class="tp-w__body" data-testid="detail-standalone">
			<Detail
				instanceId={tile.instanceId}
				settings={tile.settings}
				{onUpdateSettings}
				close={() => history.back()}
			/>
		</div>
	{:else}
		<!-- doc 13 §7: skeleton, never a spinner. -->
		<div class="tp-w__state" aria-busy="true" aria-label={m['common.detail.loading']()}>
			<TpTideGauge size={48} animated level={0.35} />
		</div>
	{/if}
</main>

<style>
	.tp-w {
		max-width: 1120px;
		margin: 0 auto;
		padding: var(--tp-page-pad, 16px);
		min-height: calc(100dvh - var(--tp-bar-h, 48px));
	}

	@media (min-width: 768px) {
		.tp-w {
			padding: 24px;
		}
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.tp-w__back {
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		text-underline-offset: 3px;
	}

	.tp-w__back:hover {
		color: var(--color-beacon);
	}

	.tp-w__body {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-850);
		padding: 1rem;
	}

	.tp-w__state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin: 4rem 0 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		text-align: center;
	}

	.tp-w__pin {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 40px;
		padding: 0 0.75rem;
	}
</style>
