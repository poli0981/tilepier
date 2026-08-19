<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { ui } from '$lib/stores/ui.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';

	/**
	 * doc 13 §8's shortcuts sheet, opened with `?`. v1 keeps global keys
	 * deliberately minimal — three of them — so this is a list, not a manual.
	 */
	const KEYS = [
		{ key: 'e', label: 'common.shortcuts.edit' },
		{ key: 'Esc', label: 'common.shortcuts.escape' },
		{ key: '?', label: 'common.shortcuts.help' }
	] as const;
</script>

{#if ui.shortcutsOpen}
	<div
		class="tp-sheet__scrim"
		role="presentation"
		onclick={() => ui.closeShortcuts()}
		data-testid="shortcuts-scrim"
	></div>

	<div
		class="tp-sheet"
		role="dialog"
		aria-modal="true"
		aria-label={m['common.shortcuts.title']()}
		data-testid="shortcuts"
	>
		<header>
			<h2>{m['common.shortcuts.title']()}</h2>
			<button type="button" aria-label={m['common.dismiss']()} onclick={() => ui.closeShortcuts()}>
				<TpIcon name="close" size={18} />
			</button>
		</header>
		<dl>
			{#each KEYS as entry (entry.key)}
				<dt><kbd>{entry.key}</kbd></dt>
				<dd>{m[entry.label]()}</dd>
			{/each}
		</dl>
	</div>
{/if}

<style>
	.tp-sheet__scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: color-mix(in oklch, var(--color-ink-950) 80%, transparent);
	}

	.tp-sheet {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 71;
		transform: translate(-50%, -50%);
		width: min(22rem, calc(100vw - 2rem));
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-850);
		box-shadow: var(--shadow-tile);
		padding: 1rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	h2 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
	}

	header button {
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

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	dt {
		margin: 0;
	}

	dd {
		margin: 0;
	}

	kbd {
		display: inline-block;
		min-width: 1.75rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		padding: 0.125rem 0.375rem;
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		text-align: center;
	}
</style>
