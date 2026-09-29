<script lang="ts">
	import type { TpPlaylist, TpTrack } from '$lib/core/storage/db';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { player } from './player.svelte';
	import { playlists } from './playlists.svelte';
	import { PLAYLIST_NAME_MAX } from './service';

	/**
	 * The chosen playlist, open (doc 09 §2): its name, play, delete — asked
	 * first, inline, saying the songs stay — and its songs with up, down and off.
	 *
	 * **Up and down, not drag** — the Week 7 plan priced drag-to-reorder and took
	 * the buttons, which the currency detail already uses, work from a keyboard
	 * as they are, and need no drag library the budget would have to carry. A
	 * song since removed from the library keeps its place, greyed, until the
	 * reader takes it off; the player skips it (plan S25).
	 */
	interface Props {
		list: TpPlaylist;
		/** The library by id — what each entry still points at. */
		byId: ReadonlyMap<string, TpTrack>;
	}

	let { list, byId }: Props = $props();

	let confirming = $state(false);

	const entries = $derived(list.trackIds.map((id) => ({ id, track: byId.get(id) })));

	/** Plays the playlist — the songs still in the library — from `startId`. */
	function play(startId?: string): void {
		const ids = list.trackIds.filter((id) => byId.has(id));
		const first = startId ?? ids[0];
		if (first === undefined) return;
		player.playTracks(ids, first, { kind: 'playlist', id: list.id });
	}

	function rename(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		// A blank name is not kept, so the field goes back to the one that is.
		if (input.value.trim() === '') input.value = list.name;
		else void playlists.rename(list.id, input.value);
	}

	function renameKey(event: KeyboardEvent): void {
		if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
	}
</script>

<div class="tp-mple" data-testid="music-playlist">
	<div class="tp-mple__head">
		<input
			class="tp-mple__name"
			value={list.name}
			maxlength={PLAYLIST_NAME_MAX}
			aria-label={m['widget.music.playlist_name']()}
			onchange={rename}
			onkeydown={renameKey}
		/>
		<button
			type="button"
			aria-label={m['widget.music.playlist_play']()}
			disabled={entries.every((entry) => entry.track === undefined)}
			onclick={() => play()}
		>
			<TpIcon name="play" size={16} />
		</button>
		<button
			type="button"
			aria-label={m['widget.music.playlist_delete']()}
			onclick={() => (confirming = true)}
		>
			<TpIcon name="trash" size={16} />
		</button>
	</div>

	{#if confirming}
		<p class="tp-mple__confirm" role="alert">
			{m['widget.music.playlist_delete_confirm']({ name: list.name })}
			<button
				type="button"
				class="tp-mple__danger"
				onclick={() => {
					confirming = false;
					void playlists.remove(list.id);
				}}
			>
				{m['widget.music.delete']()}
			</button>
			<button type="button" onclick={() => (confirming = false)}>{m['widget.music.keep']()}</button>
		</p>
	{/if}

	{#if entries.length === 0}
		<p class="tp-mple__empty">{m['widget.music.playlist_empty']()}</p>
	{:else}
		<ol>
			{#each entries as entry, index (`${entry.id}:${index}`)}
				{@const title = entry.track?.title ?? m['widget.music.gone_from_library']()}
				<li class:tp-mple__gone={entry.track === undefined}>
					<button
						type="button"
						class="tp-mple__song"
						disabled={entry.track === undefined}
						onclick={() => play(entry.id)}
					>
						{title}
					</button>
					<button
						type="button"
						aria-label={m['widget.music.move_up']({ title })}
						disabled={index === 0}
						onclick={() => void playlists.move(list.id, index, -1)}
					>
						<span class="tp-mple__up"><TpIcon name="chevron" size={14} /></span>
					</button>
					<button
						type="button"
						aria-label={m['widget.music.move_down']({ title })}
						disabled={index === entries.length - 1}
						onclick={() => void playlists.move(list.id, index, 1)}
					>
						<TpIcon name="chevron" size={14} />
					</button>
					<button
						type="button"
						aria-label={m['widget.music.remove_from_playlist']({ title })}
						onclick={() => void playlists.removeAt(list.id, index)}
					>
						<TpIcon name="close" size={14} />
					</button>
				</li>
			{/each}
		</ol>
	{/if}
</div>

<style>
	.tp-mple {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		font-size: var(--text-xs);
		padding: 0.625rem;
	}

	.tp-mple__head {
		display: flex;
		gap: 0.375rem;
	}

	.tp-mple__name {
		min-width: 0;
		min-height: 36px;
		flex: 1;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		color: var(--color-fg);
		font: inherit;
		padding: 0 0.625rem;
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 36px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		padding: 0 0.5rem;
	}

	button:disabled {
		color: var(--color-fg-dim);
		cursor: default;
	}

	button:focus-visible,
	.tp-mple__name:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	.tp-mple__confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		color: var(--color-fg-mute);
	}

	.tp-mple__danger {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.tp-mple__empty {
		margin: 0;
		color: var(--color-fg-mute);
	}

	ol {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		gap: 0.25rem;
	}

	li button {
		border-color: transparent;
	}

	.tp-mple__song {
		overflow: hidden;
		min-width: 0;
		flex: 1;
		justify-content: flex-start;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mple__gone .tp-mple__song {
		font-style: italic;
	}

	/* The chevron points down; turned over, it is "move up" (names.ts). */
	.tp-mple__up {
		display: inline-flex;
		transform: rotate(180deg);
	}
</style>
