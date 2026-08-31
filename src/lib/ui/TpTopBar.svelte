<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages';
	import { online } from '$lib/stores/online.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';

	/**
	 * doc 13 §1. 48 px, logo-mark and wordmark on the left, centre deliberately
	 * empty — calm is the point — and add / edit / settings / about on the right.
	 *
	 * The offline chip (doc 13 §7) sits left of centre rather than in the right
	 * cluster: it is state, not a control, and mixing the two invites a click.
	 */
</script>

<header class="tp-bar">
	<a class="tp-bar__brand" href={resolve('/')}>
		<TpTideGauge level={0.55} animated size={22} />
		<span class="tp-bar__wordmark">TilePier</span>
	</a>

	{#if !online.isOnline}
		<span class="tp-bar__chip" role="status" data-testid="offline-chip"
			>{m['common.offline.title']()}</span
		>
	{/if}

	<div class="tp-bar__spacer"></div>

	<nav class="tp-bar__actions">
		<button
			type="button"
			class="tp-bar__button"
			data-testid="open-drawer"
			aria-label={m['common.add_widget']()}
			onclick={() => ui.openDrawer()}
		>
			<TpIcon name="plus" size={18} />
		</button>

		<button
			type="button"
			class="tp-bar__button"
			data-testid="toggle-edit"
			aria-label={m['common.edit_mode']()}
			aria-pressed={ui.editMode}
			onclick={() => ui.toggleEdit()}
		>
			<TpIcon name="edit" size={18} />
		</button>

		<a class="tp-bar__button" href={resolve('/settings')} aria-label={m['settings.title']()}>
			<TpIcon name="settings" size={18} />
		</a>

		<a class="tp-bar__button" href={resolve('/about')} aria-label={m['about.title']()}>
			<TpIcon name="quote" size={18} />
		</a>
	</nav>
</header>

{#if ui.editMode}
	<!-- doc 13 §2: a slim beacon strip under the bar names the mode. -->
	<div class="tp-bar__mode" data-testid="edit-strip">
		<span>{m['common.editing']()}</span>
		<button type="button" onclick={() => ui.toggleEdit()}>{m['common.done']()}</button>
	</div>
{/if}

<style>
	.tp-bar {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: var(--tp-bar-h, 48px);
		padding: 0 var(--tp-page-pad, 16px);
		border-bottom: 1px solid var(--color-ink-700);
		background: var(--color-ink-950);
	}

	.tp-bar__brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-fg);
		text-decoration: none;
	}

	.tp-bar__wordmark {
		font-weight: 600;
		font-size: var(--text-base);
		letter-spacing: -0.01em;
	}

	/* doc 13 §7: a quiet amber chip, not an alarm. */
	.tp-bar__chip {
		border: 1px solid var(--color-warn);
		border-radius: var(--radius-ctl);
		padding: 0.125rem 0.5rem;
		color: var(--color-warn);
		font-size: var(--text-2xs);
	}

	.tp-bar__spacer {
		flex: 1 1 auto;
	}

	.tp-bar__actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.tp-bar__button {
		display: flex;
		align-items: center;
		justify-content: center;
		/* doc 13 §8: interactive targets are at least 40 px. */
		min-width: 40px;
		min-height: 40px;
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
	}

	.tp-bar__button:hover {
		color: var(--color-fg);
		background: var(--color-ink-900);
	}

	.tp-bar__button[aria-pressed='true'] {
		color: var(--color-beacon);
		background: var(--color-beacon-soft);
	}

	.tp-bar__mode {
		position: sticky;
		top: var(--tp-bar-h, 48px);
		z-index: 49;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.25rem var(--tp-page-pad, 16px);
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
		font-size: var(--text-2xs);
	}

	.tp-bar__mode button {
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		min-height: 24px;
		padding: 0 0.25rem;
	}
</style>
