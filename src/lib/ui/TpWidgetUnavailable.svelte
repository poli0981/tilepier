<script lang="ts">
	import type { TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';

	/**
	 * A tile whose code is not on this device and could not be fetched (doc 17
	 * §2): a widget added with no connection that this browser has never loaded.
	 *
	 * Since Week 8 the service worker precaches the shell, not every widget, so
	 * this is a real state rather than a theoretical one. Before it, the deck
	 * loaded every tile's chunk in one `Promise.all`: one that failed left the
	 * whole deck blank, and one added from the drawer left an empty tile and an
	 * unhandled rejection. Never a spinner or a blank (doc 13 §7) — a sentence
	 * and a way to try again once the connection is back.
	 */
	let { size }: TpWidgetProps = $props();
</script>

<div class="tp-unavailable" role="status" data-tier={size.tier} data-testid="widget-unavailable">
	<p>{m['common.tile.unavailable']()}</p>
	<button type="button" onclick={() => location.reload()}>{m['common.retry']()}</button>
</div>

<style>
	.tp-unavailable {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-unavailable p {
		margin: 0;
	}

	.tp-unavailable button {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		min-height: var(--tp-target);
		padding: 0 0.75rem;
	}
</style>
