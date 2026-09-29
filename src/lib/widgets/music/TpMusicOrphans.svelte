<script lang="ts">
	import { fmtBytes } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import { collection } from './collection.svelte';

	/**
	 * Imported songs a replacing restore left without tracks (plan S25): how
	 * many, what they weigh, why they were kept — restoring the backup that
	 * restore saved first brings them back — and a delete that asks first.
	 * Nothing else ever deletes imported audio.
	 */

	let confirming = $state(false);

	const count = $derived(collection.orphans.ids.length);
	const size = $derived(fmtBytes(collection.orphans.bytes, settings.locale));

	async function remove(): Promise<void> {
		confirming = false;
		await collection.deleteOrphans();
	}
</script>

{#if count > 0}
	<div class="tp-morphans" data-testid="music-orphans">
		<p>{m['widget.music.orphans']({ count, size })}</p>
		{#if confirming}
			<p class="tp-morphans__confirm" role="alert">
				{m['widget.music.orphans_confirm']({ count, size })}
				<button type="button" class="tp-morphans__danger" onclick={() => void remove()}>
					{m['widget.music.delete']()}
				</button>
				<button type="button" onclick={() => (confirming = false)}>
					{m['widget.music.keep']()}
				</button>
			</p>
		{:else}
			<button type="button" onclick={() => (confirming = true)}>
				{m['widget.music.orphans_delete']()}
			</button>
		{/if}
	</div>
{/if}

<style>
	.tp-morphans {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		padding: 0.625rem;
	}

	p {
		margin: 0;
	}

	.tp-morphans__confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	button {
		min-height: 36px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		padding: 0 0.625rem;
	}

	button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	.tp-morphans__danger {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
</style>
