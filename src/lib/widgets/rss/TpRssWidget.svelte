<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import { setTileStatus, type TpTileStatus } from '$lib/core/tile-status';
	import { tileView } from '$lib/core/tile-view';
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { problemText, troubleText } from './labels';
	import { TpFeedSources } from './sources.svelte';
	import TpRssAddFeed from './TpRssAddFeed.svelte';
	import TpRssFeedSource from './TpRssFeedSource.svelte';
	import {
		feedName,
		mergeItems,
		monogramOf,
		readSettings,
		rssBadge,
		troubleOf,
		type TpFeedTrouble,
		type TpFeedView
	} from './service';

	/**
	 * doc 08 §4's tile: every feed of this instance merged into one list, newest
	 * first, with an unread dot on what arrived since the detail was last opened.
	 *
	 * **Sources.** One renderless `TpRssFeedSource` per feed, each subscribing
	 * and registering its own refresh, and each mounted only once its URL has
	 * been hashed — the hash is the key, and `crypto.subtle` is async. The tile
	 * reads their handles out of a map and derives everything from them.
	 *
	 * **States (doc 06 §3).** rss is doc 17 §3's cached-data class, so all seven
	 * are required:
	 * - `empty` — no feeds; the one action is the box to add the first, right
	 *   here, because a feed URL is something a person pastes rather than picks.
	 * - `loading` — skeleton rows while no feed has answered and one still asks.
	 * - `ready` — the merged list, and a chip per feed with a problem (doc 08
	 *   §4's "dead feed → per-feed error chip, others keep working").
	 * - `stale`, `stale-error`, `offline` — the host header, by rss's own badge
	 *   rule (`rssBadge`): the header speaks for the tile, and one feed's trouble
	 *   stays on its chip.
	 * - `error` — inline with a retry when no feed could be read; with the
	 *   feeds' own reasons instead when every one of them answered that it is
	 *   not a feed, since retrying an answer changes nothing.
	 * - `permission-needed` is **forbidden**: the manifest declares no
	 *   `permissions` (doc 06 §3).
	 */
	interface Props extends TpWidgetProps {
		/** Test seam: a throwaway Dexie, the way the other networked tiles take one. */
		db?: TpDb | undefined;
	}

	let {
		instanceId,
		settings: tileSettings,
		size,
		onOpenDetail,
		onUpdateSettings,
		db = undefined
	}: Props = $props();

	const prefs = $derived(readSettings(tileSettings));

	/* ─────────────────────────────────────────────────────────── the sources */

	const sources = new TpFeedSources(() => prefs.feeds);

	/** In the reader's order, and only the feeds that have a source yet. */
	const views = $derived(sources.views(prefs.feeds));

	const view = $derived(sources.hashFailed ? 'error' : tileView(views));
	const isEmpty = $derived(prefs.feeds.length === 0);

	/* ──────────────────────────────────────────────────────────── the list */

	/** Enough to fill a 6×6 tile; the detail has the rest. */
	const TILE_ITEMS = 40;

	const entries = $derived(mergeItems(views, prefs.lastOpenedAt, TILE_ITEMS));

	const troubles = $derived(
		views.flatMap((feed) => {
			const trouble = troubleOf(feed);
			return trouble === null ? [] : [{ feed, trouble }];
		})
	);

	/** Every feed answered, and every answer was "not a feed". */
	const nothingReadable = $derived(
		views.length === prefs.feeds.length &&
			views.length > 0 &&
			views.every((feed) => feed.unavailable !== null)
	);

	let now = $state(Date.now());
	$effect(() => {
		// Keeps each line's age honest on a deck left open, and is what lets the
		// host badge carry finished text instead of a timestamp.
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	function ageOf(at: number | undefined): string {
		return at === undefined ? '' : fmtRelative(at, settings.locale, now);
	}

	function titleOf(title: string): string {
		return title === '' ? m['widget.rss.untitled']() : title;
	}

	/** The chip's longer line, for its tooltip and its accessible name. */
	function chipLabel(feed: TpFeedView, trouble: TpFeedTrouble): string {
		return troubleText(feedName(feed), trouble, ageOf);
	}

	/** Chips shown before the rest collapse into a count, so a tile with five
	 *  dead feeds still has room for the ones that work. */
	const CHIPS_SHOWN = 2;

	/** Every feed, because the reader pressed one button — one function for
	 *  the life of the tile (`sources.retry`), as the host badge needs. */
	const retry = sources.retry;

	/** doc 13 §7's badge, published to the host header (doc 13 §3). */
	const badge = $derived.by<TpTileStatus | null>(() => {
		const worst = rssBadge(views, now);
		if (worst === null) return null;
		if (worst.kind === 'offline') return { kind: 'offline', age: '', retry: null };
		if (worst.kind === 'stale-error') return { kind: 'stale-error', age: ageOf(worst.at), retry };
		return { kind: 'stale', age: ageOf(worst.at), retry: null };
	});

	$effect(() => {
		const next = badge;
		untrack(() => setTileStatus(instanceId, next));
	});

	// Teardown only, for the reason the markets tile gives: folded into the
	// effect above, every heartbeat would be a delete and an insert.
	$effect(() => {
		const id = untrack(() => instanceId);
		return () => setTileStatus(id, null);
	});

	/** doc 13 §3's tier L names each line's feed; below it the monogram does,
	 *  and the name is still there for a screen reader. */
	const roomy = $derived(size.tier === 'L');

	const SKELETON_ROWS = [0, 1, 2, 3, 4];

	/** The first feed starts the watermark, not the first opening — otherwise its
	 *  whole back catalogue would arrive unread (types.ts). */
	function addFirst(feeds: string[]): void {
		onUpdateSettings?.({ feeds, lastOpenedAt: prefs.lastOpenedAt ?? Date.now() });
	}
</script>

{#each prefs.feeds as url (url)}
	{@const hash = sources.hashes.get(url)}
	{#if hash !== undefined}
		<TpRssFeedSource
			{instanceId}
			{url}
			{hash}
			{db}
			onHandle={sources.onHandle}
			onGone={sources.onGone}
		/>
	{/if}
{/each}

{#if isEmpty}
	<!-- doc 06 §3's `empty`: first-run guidance with exactly one action. -->
	<div class="tp-rss-add">
		<p class="tp-rss-add__title">{m['widget.rss.no_feeds']()}</p>
		<TpRssAddFeed feeds={prefs.feeds} onAdd={addFirst} id="{instanceId}-rss-add" />
	</div>
{:else if view === 'loading'}
	<!-- doc 12 §7: skeleton blocks, never a spinner. -->
	<div class="tp-rss-skeleton" aria-label={m['widget.rss.loading']()}>
		{#each SKELETON_ROWS as row (row)}
			<div class="tp-rss-skeleton__row"></div>
		{/each}
	</div>
{:else if view !== 'list'}
	<!-- Inline, never blank (doc 13 §7). Only when no feed has anything to show:
	     a tile still holding items through a failure keeps them and says so
	     through the host badge and the feeds' chips instead. -->
	<div class="tp-rss-error" data-testid="rss-error">
		<TpIcon name="rss" size={20} />
		{#if sources.hashFailed}
			<p class="tp-rss-error__text">{m['widget.rss.insecure']()}</p>
		{:else if nothingReadable}
			<p class="tp-rss-error__text">{m['widget.rss.nothing_readable']()}</p>
			<ul class="tp-rss-chips">
				{#each troubles as { feed, trouble } (feed.url)}
					<li class="tp-rss-chip" title={chipLabel(feed, trouble)}>
						<span class="tp-rss-mono" aria-hidden="true"
							>{monogramOf(feedName(feed), settings.locale)}</span
						>
						<span class="tp-rss-chip__text">{chipLabel(feed, trouble)}</span>
					</li>
				{/each}
			</ul>
			{#if onOpenDetail}
				<button type="button" class="tp-rss-error__action" onclick={() => onOpenDetail?.()}>
					{m['widget.rss.manage']()}
				</button>
			{/if}
		{:else}
			<p class="tp-rss-error__text">
				{#if view === 'offline'}
					{m['widget.rss.offline']()}
				{:else if view === 'rate-limited'}
					{m['widget.rss.rate_limited']()}
				{:else}
					{m['widget.rss.error']()}
				{/if}
			</p>
			<button type="button" class="tp-rss-error__action" onclick={retry}>
				{m['common.retry']()}
			</button>
		{/if}
	</div>
{:else}
	{#if troubles.length > 0}
		<ul class="tp-rss-chips" aria-label={m['widget.rss.troubles_label']()} data-testid="rss-chips">
			{#each troubles.slice(0, CHIPS_SHOWN) as { feed, trouble } (feed.url)}
				<li>
					<button
						type="button"
						class="tp-rss-chip"
						title={chipLabel(feed, trouble)}
						aria-label={chipLabel(feed, trouble)}
						onclick={() => onOpenDetail?.()}
						disabled={onOpenDetail === undefined}
					>
						<span class="tp-rss-mono" aria-hidden="true"
							>{monogramOf(feedName(feed), settings.locale)}</span
						>
						<span class="tp-rss-chip__text" aria-hidden="true">{problemText(trouble)}</span>
					</button>
				</li>
			{/each}
			{#if troubles.length > CHIPS_SHOWN}
				<li class="tp-rss-chips__more">
					{m['widget.rss.troubles_more']({ count: troubles.length - CHIPS_SHOWN })}
				</li>
			{/if}
		</ul>
	{/if}

	{#if entries.length === 0}
		<p class="tp-rss-quiet">{m['widget.rss.nothing_yet']()}</p>
	{:else}
		<ul class="tp-rss-list" aria-label={m['widget.rss.list_label']()} data-testid="rss-list">
			{#each entries as entry (entry.key)}
				<li class="tp-rss-item">
					<span class="tp-rss-item__head">
						{#if entry.unread}
							<span class="tp-rss-item__dot" role="img" aria-label={m['widget.rss.unread']()}
							></span>
						{/if}
						<!-- A stranger's text, as text: doc 15 §4 — never `{@html}` on a tile. -->
						{#if entry.link !== null}
							<!-- Not a route of this app, so there is nothing to resolve(): an
							     absolute http(s) URL off the feed, checked by `openableLink`,
							     opening in a new tab with no opener. -->
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								class="tp-rss-item__title"
								href={entry.link}
								target="_blank"
								rel="noopener noreferrer"
								lang={entry.lang}>{titleOf(entry.item.title)}</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{:else}
							<span class="tp-rss-item__title" lang={entry.lang}>{titleOf(entry.item.title)}</span>
						{/if}
					</span>
					<span class="tp-rss-item__meta">
						<span class="tp-rss-mono" aria-hidden="true"
							>{monogramOf(entry.feedName, settings.locale)}</span
						>
						{#if roomy}
							<span class="tp-rss-item__source" lang={entry.lang}>{entry.feedName}</span>
						{:else}
							<span class="tp-rss-sr">{entry.feedName}</span>
						{/if}
						<span class="tp-rss-item__age">
							{entry.dated ? ageOf(entry.at) : m['widget.rss.undated']()}
						</span>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.tp-rss-list {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.375rem;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-rss-item {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: var(--text-xs);
		line-height: 1.35;
	}

	.tp-rss-item__head {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
	}

	/* doc 08 §4's unread-style dot: the beacon, which is the deck's "new" colour. */
	.tp-rss-item__dot {
		width: 0.375rem;
		height: 0.375rem;
		flex: none;
		align-self: center;
		border-radius: 999px;
		background: var(--color-beacon);
	}

	.tp-rss-item__title {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		color: var(--color-fg);
		overflow-wrap: anywhere;
		text-decoration: none;
	}

	a.tp-rss-item__title:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	a.tp-rss-item__title:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
		border-radius: 2px;
	}

	.tp-rss-item__meta {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-rss-item__source {
		overflow: hidden;
		min-width: 0;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-rss-item__age {
		flex: none;
	}

	/* Read, not shown: the feed's name at the tiers where only its letter fits. */
	.tp-rss-sr {
		position: absolute;
		overflow: hidden;
		width: 1px;
		height: 1px;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* The feed's letter (doc 08 §4, standing in for a favicon the CSP would
	   refuse). One neutral token for every feed: a colour per feed would borrow
	   meaning from the up/down/danger tokens that already carry some. */
	.tp-rss-mono {
		display: inline-flex;
		width: 1rem;
		height: 1rem;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		background: var(--color-ink-700);
		color: var(--color-fg);
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1;
	}

	.tp-rss-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		margin: 0 0 0.375rem;
		padding: 0;
		list-style: none;
	}

	.tp-rss-chip {
		display: inline-flex;
		max-width: 100%;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid var(--color-warn);
		border-radius: 999px;
		background: transparent;
		color: var(--color-warn);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		padding: 0.0625rem 0.375rem 0.0625rem 0.125rem;
	}

	.tp-rss-chip:disabled {
		cursor: default;
	}

	.tp-rss-chip:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	.tp-rss-chip__text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-rss-chips__more {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-rss-quiet {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-xs);
	}

	.tp-rss-skeleton {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.25rem;
	}

	.tp-rss-skeleton__row {
		height: 1.75rem;
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
	}

	.tp-rss-add,
	.tp-rss-error {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.375rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-rss-add__title,
	.tp-rss-error__text {
		margin: 0;
	}

	.tp-rss-error__action {
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		padding-block: 0.125rem;
		padding-inline: 0;
		text-align: left;
	}

	.tp-rss-error__action:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 2px;
	}
</style>
