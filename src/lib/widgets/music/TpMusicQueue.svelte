<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { collection } from './collection.svelte';
	import { player } from './player.svelte';
	import { upcoming } from './service';

	/**
	 * What plays after the current song (doc 09 §2's queue), in play order —
	 * shuffled or not, round the start on repeat-all. Choosing one plays it and
	 * leaves the queue as it is, which a row of the library would not: that
	 * starts a new queue from the list as it stands.
	 *
	 * A song since removed from the library keeps its place, greyed, as the
	 * player will skip it (plan S25). Titles are text nodes (CLAUDE.md rule 7).
	 */

	/** Enough to see where the queue is going; the library has the rest. */
	const SHOWN = 8;

	const byId = $derived(new Map(collection.tracks.map((track) => [track.id, track])));
	const entries = $derived(
		upcoming(player.queue, player.repeat, SHOWN).map((entry) => ({
			...entry,
			track: byId.get(entry.id)
		}))
	);
</script>

{#if entries.length > 0}
	<section class="tp-mqueue" aria-label={m['widget.music.coming_up']()} data-testid="music-queue">
		<h4>{m['widget.music.coming_up']()}</h4>
		<ol>
			{#each entries as entry (entry.index)}
				<li>
					<button
						type="button"
						disabled={entry.track === undefined}
						onclick={() => player.playAt(entry.index)}
					>
						<span class="tp-mqueue__title">
							{entry.track?.title ?? m['widget.music.gone_from_library']()}
						</span>
						{#if entry.track !== undefined}
							<span class="tp-mqueue__artist">
								{entry.track.artist || m['widget.music.unknown_artist']()}
							</span>
						{/if}
					</button>
				</li>
			{/each}
		</ol>
	</section>
{/if}

<style>
	.tp-mqueue {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.375rem;
		font-size: var(--text-xs);
	}

	h4 {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	ol {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	button {
		display: grid;
		width: 100%;
		min-height: 36px;
		align-items: center;
		gap: 0.75rem;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		padding: 0 0.5rem;
		text-align: left;
	}

	button:hover:not(:disabled) {
		background: var(--color-ink-900);
	}

	button:disabled {
		color: var(--color-fg-dim);
		cursor: default;
		font-style: italic;
	}

	button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: -2px;
	}

	.tp-mqueue__title,
	.tp-mqueue__artist {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mqueue__artist {
		color: var(--color-fg-mute);
	}
</style>
