<script lang="ts">
	import type { TpTrack } from '$lib/core/storage/db';
	import { windowOf } from '$lib/core/windowing';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { foldForSearch } from '$lib/i18n/fold';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import { collection } from './collection.svelte';
	import { player } from './player.svelte';

	/**
	 * The library, in the detail (doc 09 §2): searchable, sortable, and windowed
	 * whatever its length — doc 09 said from 500 rows and doc 20 §7 from 200; the
	 * list is always windowed, which is simpler than a threshold and never
	 * wrong (Week 7 plan S13). Rows are a fixed 44 px, which is what lets
	 * `core/windowing` be arithmetic.
	 *
	 * Search folds diacritics on both sides (`i18n/fold`), so "son tung" finds
	 * "Sơn Tùng". Every string from a file's tags is a text node (CLAUDE.md rule
	 * 7). Choosing a row plays from it, with the list as it stands — filtered and
	 * sorted — as the queue.
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

	function markOf(track: TpTrack): string | null {
		if (track.missing === true) return m['widget.music.mark_missing']();
		if (track.error === 'unsupported') return m['widget.music.mark_unsupported']();
		if (track.error === 'unreadable') return m['widget.music.mark_unreadable']();
		return null;
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
		<label class="tp-mlist__sort" for="tp-mlist-sort">{m['widget.music.sort']()}</label>
		<select id="tp-mlist-sort" bind:value={sort} data-testid="music-sort">
			<option value="library">{m['widget.music.sort_library']()}</option>
			<option value="title">{m['widget.music.sort_title']()}</option>
			<option value="added">{m['widget.music.sort_added']()}</option>
		</select>
		<span class="tp-mlist__count tp-num">
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
		<p class="tp-mlist__empty" role="status">
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
				{@const mark = markOf(track)}
				{@const current = track.id === player.current?.id}
				<li aria-setsize={visible.length} aria-posinset={view.start + offset + 1}>
					<button
						type="button"
						class="tp-mlist__row"
						class:tp-mlist__row--current={current}
						class:tp-mlist__row--marked={mark !== null}
						aria-current={current ? 'true' : undefined}
						onclick={() => play(track)}
					>
						<span class="tp-mlist__title">{track.title}</span>
						<span class="tp-mlist__artist"
							>{track.artist || m['widget.music.unknown_artist']()}</span
						>
						{#if mark !== null}
							<span class="tp-mlist__mark">{mark}</span>
						{/if}
						<span class="tp-mlist__time tp-num">
							{track.durationMs === undefined ? '' : fmtDuration(track.durationMs, settings.locale)}
						</span>
					</button>
				</li>
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
		border: 1px solid var(--color-ink-700);
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

	.tp-mlist__sort,
	.tp-mlist__count {
		color: var(--color-fg-mute);
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

	.tp-mlist__empty {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
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

	li {
		height: 44px;
	}

	.tp-mlist__row {
		display: grid;
		width: 100%;
		height: 100%;
		align-items: center;
		gap: 0.75rem;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) auto auto;
		border: 0;
		border-bottom: 1px solid var(--color-ink-700);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0 0.75rem;
		text-align: left;
	}

	.tp-mlist__row:hover {
		background: var(--color-ink-900);
	}

	.tp-mlist__row:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: -2px;
	}

	.tp-mlist__row--current .tp-mlist__title {
		color: var(--color-beacon);
	}

	.tp-mlist__row--marked {
		color: var(--color-fg-dim);
	}

	.tp-mlist__title,
	.tp-mlist__artist {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mlist__artist,
	.tp-mlist__time {
		color: var(--color-fg-mute);
	}

	.tp-mlist__time {
		grid-column: 4;
	}

	.tp-mlist__mark {
		grid-column: 3;
		border: 1px solid var(--color-ink-700);
		border-radius: 999px;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		padding: 0 0.375rem;
	}
</style>
