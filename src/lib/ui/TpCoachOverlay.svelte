<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';

	/**
	 * doc 13 §9's one-time coach: three callouts, dismiss forever. Not a tour —
	 * three sentences and a button, because the deck is already useful and the
	 * charter budgets thirty seconds to a usable desk.
	 *
	 * "Forever" is `tp.settings.v1.coachDismissed`. It had nowhere to live under
	 * the three-key rule until doc 05 §2 gained the field (doc 22 §Exit review).
	 */
	const POINTS = [
		'common.coach.add',
		'common.coach.edit',
		'common.coach.detail'
	] as const satisfies readonly string[];
</script>

{#if !settings.coachDismissed}
	<!-- A complementary landmark, not a dialog: it takes no focus, blocks
	     nothing, and the deck behind it is fully usable. -->
	<aside class="tp-coach" aria-label={m['common.coach.title']()} data-testid="coach">
		<TpTideGauge level={0.7} animated size={28} />
		<div>
			<p class="tp-coach__title">{m['common.coach.title']()}</p>
			<ul>
				{#each POINTS as key (key)}
					<li>{m[key]()}</li>
				{/each}
			</ul>
		</div>
		<button
			type="button"
			data-testid="coach-dismiss"
			onclick={() => settings.patch({ coachDismissed: true })}
		>
			{m['common.coach.dismiss']()}
		</button>
	</aside>
{/if}

<style>
	.tp-coach {
		position: fixed;
		right: var(--tp-page-pad, 16px);
		bottom: var(--tp-page-pad, 16px);
		z-index: 40;
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		max-width: min(26rem, calc(100vw - 2 * var(--tp-page-pad, 16px)));
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-850);
		box-shadow: var(--shadow-tile);
		padding: 0.875rem 1rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-coach__title {
		margin: 0 0 0.375rem;
		color: var(--color-fg);
		font-weight: 500;
	}

	ul {
		margin: 0;
		padding-left: 1rem;
	}

	li {
		margin-bottom: 0.25rem;
	}

	button {
		flex: none;
		align-self: center;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		min-height: 32px;
		padding: 0 0.625rem;
	}

	button:hover {
		background: var(--color-beacon-soft);
	}
</style>
