<script lang="ts">
	import type { TpPlaylist, TpTrack } from '$lib/core/storage/db';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';

	/**
	 * One row of the library list (`TpMusicLibrary`): the track as a button that
	 * plays it, and — while a playlist is chosen — a "+" that adds it there.
	 *
	 * Title, artist and marks are text nodes (CLAUDE.md rule 7). The row is a
	 * fixed 44 px, which the list's windowing depends on; `setsize` and `posinset`
	 * tell a screen reader where it sits in the whole library, not in the few
	 * dozen rows actually rendered.
	 */
	interface Props {
		track: TpTrack;
		current: boolean;
		setsize: number;
		posinset: number;
		addTo: TpPlaylist | null;
		onPlay: () => void;
		onAdd: () => void;
	}

	let { track, current, setsize, posinset, addTo, onPlay, onAdd }: Props = $props();

	const mark = $derived(
		track.missing === true
			? m['widget.music.mark_missing']()
			: track.error === 'unsupported'
				? m['widget.music.mark_unsupported']()
				: track.error === 'unreadable'
					? m['widget.music.mark_unreadable']()
					: null
	);
</script>

<li aria-setsize={setsize} aria-posinset={posinset}>
	<button
		type="button"
		class="tp-mrow"
		class:tp-mrow--current={current}
		class:tp-mrow--marked={mark !== null}
		aria-current={current ? 'true' : undefined}
		onclick={onPlay}
	>
		<span class="tp-mrow__title">{track.title}</span>
		<span class="tp-mrow__artist">{track.artist || m['widget.music.unknown_artist']()}</span>
		{#if mark !== null}
			<span class="tp-mrow__mark">{mark}</span>
		{/if}
		<span class="tp-mrow__time tp-num">
			{track.durationMs === undefined ? '' : fmtDuration(track.durationMs, settings.locale)}
		</span>
	</button>
	{#if addTo !== null}
		<button
			type="button"
			class="tp-mrow__add"
			aria-label={m['widget.music.add_to_playlist']({ title: track.title, playlist: addTo.name })}
			disabled={addTo.trackIds.includes(track.id)}
			onclick={onAdd}
		>
			<TpIcon name="plus" size={14} />
		</button>
	{/if}
</li>

<style>
	li {
		display: flex;
		height: 44px;
		border-bottom: 1px solid var(--color-ink-700);
	}

	.tp-mrow {
		display: grid;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 0.75rem;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) auto auto;
		border: 0;
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0 0.75rem;
		text-align: left;
	}

	.tp-mrow:hover {
		background: var(--color-ink-900);
	}

	.tp-mrow:focus-visible,
	.tp-mrow__add:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: -2px;
	}

	.tp-mrow--current .tp-mrow__title {
		color: var(--color-beacon);
	}

	.tp-mrow--marked {
		color: var(--color-fg-dim);
	}

	.tp-mrow__title,
	.tp-mrow__artist {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mrow__artist,
	.tp-mrow__time {
		color: var(--color-fg-mute);
	}

	.tp-mrow__mark {
		grid-column: 3;
		border: 1px solid var(--color-ink-700);
		border-radius: 999px;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		padding: 0 0.375rem;
	}

	.tp-mrow__time {
		grid-column: 4;
	}

	.tp-mrow__add {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: 44px;
		border: 0;
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
	}

	.tp-mrow__add:hover:not(:disabled) {
		color: var(--color-beacon);
	}

	.tp-mrow__add:disabled {
		color: var(--color-fg-dim);
		cursor: default;
	}
</style>
