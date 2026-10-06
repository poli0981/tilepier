<script lang="ts">
	import type { TpTrack } from '$lib/core/storage/db';
	import { windowOf } from '$lib/core/windowing';
	import { foldForSearch } from '$lib/i18n/fold';
	import { m } from '$lib/paraglide/messages';
	import { collection } from './collection.svelte';
	import { player } from './player.svelte';
	import { playlists } from './playlists.svelte';
	import TpMusicTrackRow from './TpMusicTrackRow.svelte';

	/**
	 * The library, in the detail (doc 09 §2): searchable, sortable, and windowed
	 * whatever its length — doc 09 said from 500 rows and doc 20 §7 from 200; the
	 * list is always windowed, which is simpler than a threshold and never
	 * wrong (Week 7 plan S13). Rows are a fixed 44 px (`TpMusicTrackRow`), which
	 * is what lets `core/windowing` be arithmetic.
	 *
	 * Search folds diacritics on both sides (`i18n/fold`), so "son tung" finds
	 * "Sơn Tùng". Choosing a row plays from it, with the list as it stands —
	 * filtered and sorted — as the queue.
	 */

	const ROW_PX = 44;
	type TpSort = 'library' | 'title' | 'added';

	let query = $state('');
	let sort = $state<TpSort>('library');
	let scrollTop = $state(0);
	let viewportPx = $state(0);

	const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

	/** Folded once per library, not once per keystroke per row. */
	const folded = $derived(
		new Map(
			collection.tracks.map((track) => [
				track.id,
				foldForSearch(`${track.title} ${track.artist} ${track.album}`)
			])
		)
	);

	const visible = $derived.by(() => {
		const needle = foldForSearch(query.trim());
		const rows =
			needle === ''
				? collection.tracks
				: collection.tracks.filter((track) => folded.get(track.id)?.includes(needle) === true);
		if (sort === 'title') return [...rows].sort((a, b) => collator.compare(a.title, b.title));
		if (sort === 'added') return [...rows].sort((a, b) => b.addedAt - a.addedAt);
		// The store already holds library order.
		return rows;
	});

	const view = $derived(windowOf(scrollTop, viewportPx, ROW_PX, visible.length));
	const rows = $derived(visible.slice(view.start, view.end));
	const padTop = $derived(`${view.before}px`);
	const padBottom = $derived(`${view.after}px`);

	function play(track: TpTrack): void {
		player.playTracks(
			visible.map((entry) => entry.id),
			track.id,
			{ kind: 'library' }
		);
	}

	function add(track: TpTrack): void {
		const target = playlists.active;
		if (target !== null) void playlists.add(target.id, track.id);
	}

	function searchKeydown(event: KeyboardEvent): void {
		// Esc empties a search first, and only an empty one lets the key through
		// to close the detail (doc 13 §8: the topmost layer).
		if (event.key === 'Escape' && query !== '') {
			query = '';
			event.stopPropagation();
		}
	}
</script>

<section class="tp-mlist" aria-label={m['widget.music.library']()}>
	<div class="tp-mlist__bar">
		<input
			type="search"
			class="tp-mlist__search"
			bind:value={query}
			placeholder={m['widget.music.search']()}
			aria-label={m['widget.music.search']()}
			onkeydown={searchKeydown}
			data-testid="music-search"
		/>
		<label class="tp-mlist__muted" for="tp-mlist-sort">{m['widget.music.sort']()}</label>
		<select id="tp-mlist-sort" bind:value={sort} data-testid="music-sort">
			<option value="library">{m['widget.music.sort_library']()}</option>
			<option value="title">{m['widget.music.sort_title']()}</option>
			<option value="added">{m['widget.music.sort_added']()}</option>
		</select>
		<span class="tp-mlist__muted tp-num">
			{m['widget.music.track_count']({ count: visible.length })}
		</span>
		{#if collection.missingCount > 0}
			<button
				type="button"
				class="tp-mlist__remove"
				onclick={() => void collection.removeMissing()}
				data-testid="music-remove-missing"
			>
				{m['widget.music.remove_missing']({ count: collection.missingCount })}
			</button>
		{/if}
	</div>

	{#if visible.length === 0 && query.trim() !== ''}
		<p class="tp-mlist__muted" role="status">
			{m['widget.music.no_match']({ query: query.trim() })}
		</p>
	{/if}

	<div
		class="tp-mlist__scroll"
		bind:clientHeight={viewportPx}
		onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
		data-testid="music-list"
	>
		<ul style:padding-top={padTop} style:padding-bottom={padBottom}>
			{#each rows as track, offset (track.id)}
				<TpMusicTrackRow
					{track}
					current={track.id === player.current?.id}
					setsize={visible.length}
					posinset={view.start + offset + 1}
					addTo={playlists.active}
					onPlay={() => play(track)}
					onAdd={() => add(track)}
				/>
			{/each}
		</ul>
	</div>
</section>

<style>
	.tp-mlist {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tp-mlist__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-xs);
	}

	.tp-mlist__search,
	select {
		min-height: 36px;
		border: 1px solid var(--color-field);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		color: var(--color-fg);
		font: inherit;
		padding: 0 0.625rem;
	}

	.tp-mlist__search {
		min-width: 0;
		flex: 1 1 12rem;
	}

	.tp-mlist__muted {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-mlist__remove {
		border: 0;
		background: none;
		color: var(--color-warn);
		cursor: pointer;
		font: inherit;
		padding: 0.25rem 0;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.tp-mlist__scroll {
		overflow-y: auto;
		height: min(28rem, 55dvh);
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
	}

	ul {
		margin: 0;
		padding-right: 0;
		padding-left: 0;
		list-style: none;
	}
</style>
