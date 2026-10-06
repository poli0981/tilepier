<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { collection } from './collection.svelte';
	import { playlists } from './playlists.svelte';
	import { PLAYLIST_NAME_MAX } from './service';
	import TpMusicPlaylistEditor from './TpMusicPlaylistEditor.svelte';

	/**
	 * doc 09 §2's playlists: make one, choose one, and the chosen one opens
	 * below (`TpMusicPlaylistEditor`). Choosing a playlist also makes it the one
	 * the library's "+" buttons add to; choosing it again puts the "+" away.
	 */

	let draft = $state('');

	$effect(() => {
		// The playlists, read once per page and shared with the library list.
		untrack(() => void playlists.load());
	});

	const byId = $derived(new Map(collection.tracks.map((track) => [track.id, track])));

	async function create(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const made = await playlists.create(draft);
		if (made !== null) draft = '';
	}
</script>

<section class="tp-mpl" aria-label={m['widget.music.playlists']()} data-testid="music-playlists">
	<div class="tp-mpl__bar">
		<h4>{m['widget.music.playlists']()}</h4>
		<form class="tp-mpl__new" onsubmit={create}>
			<input
				bind:value={draft}
				maxlength={PLAYLIST_NAME_MAX}
				placeholder={m['widget.music.playlist_new']()}
				aria-label={m['widget.music.playlist_new']()}
				data-testid="music-playlist-name"
			/>
			<button type="submit" disabled={draft.trim() === ''}>
				<TpIcon name="plus" size={14} />
				{m['widget.music.playlist_create']()}
			</button>
		</form>
	</div>

	{#if playlists.list.length > 0}
		<ul class="tp-mpl__chips">
			{#each playlists.list as list (list.id)}
				<li>
					<button
						type="button"
						aria-pressed={list.id === playlists.activeId}
						onclick={() => playlists.choose(list.id === playlists.activeId ? null : list.id)}
					>
						{list.name}
						<span class="tp-num">{list.trackIds.length}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if playlists.active !== null}
		<TpMusicPlaylistEditor list={playlists.active} {byId} />
	{/if}
</section>

<style>
	.tp-mpl {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: var(--text-xs);
	}

	.tp-mpl__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	h4 {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.tp-mpl__new {
		display: flex;
		gap: 0.375rem;
	}

	input {
		min-height: 36px;
		border: 1px solid var(--color-field);
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
	input:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	.tp-mpl__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-mpl__chips button[aria-pressed='true'] {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	.tp-mpl__chips .tp-num {
		color: var(--color-fg-mute);
	}
</style>
