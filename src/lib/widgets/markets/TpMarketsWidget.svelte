<script lang="ts">
	import { untrack } from 'svelte';
	import { useRefresh } from '$lib/core/refresh.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import { setTileStatus, type TpTileStatus } from '$lib/core/tile-status';
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtPercentChange, fmtPrice, fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		cryptoLookup,
		cryptoSource,
		priceDigits,
		readSettings,
		rowsFor,
		symbolsOf,
		tickerKey,
		type TpTickerReading
	} from './service';

	/**
	 * doc 09 §1's tile: watchlist rows, each a symbol, a last price and a 24 h
	 * change chip.
	 *
	 * **Tier S does not exist here.** `min` is 2×2 and doc 13 §3's tier S is
	 * `w <= 2 && h <= 1`, so nothing this widget can be resized to reaches it —
	 * one tier fewer than `currency` had to build, named rather than left as a
	 * gap in the DoD. A watchlist is a list, and a list has no honest one-line
	 * rendering.
	 *
	 * **The scheduler id is the `instanceId`, not the data key**, which is a
	 * deviation from doc 04 §3's rule for networked widgets and the first time
	 * that rule has met a widget with *two* data keys — the crypto set and, from
	 * Week 5b, the stock set. That section says the id is the caller's choice;
	 * this is the first choice that is not obvious. `multiInstance: false` makes
	 * it safe: there is exactly one markets tile, so there is no second
	 * registration for a shared id to de-duplicate.
	 *
	 * It also removes weather's `{#key}` remount dance. `useRefresh` snapshots
	 * its id at mount, so a widget registered under a data key has to be
	 * remounted when that key moves — and this key moves every time the reader
	 * edits the watchlist. Registered under the instance, the cadence outlives
	 * every edit and only the `swr` subscription is rebuilt.
	 *
	 * **States (doc 06 §3).** `markets` is doc 17 §3's cached-data class, so all
	 * seven are required. Five map from `TpSwrStatus`; `stale` and `stale-error`
	 * leave through `core/tile-status` to the host header rather than being drawn
	 * here (doc 13 §7). `empty` is the judgement `swr` cannot make, and here it is
	 * an empty watchlist — a reader can remove every row, and that is a state
	 * rather than a fault. `permission-needed` is **forbidden**: the manifest
	 * declares no `permissions` (doc 06 §3's single-widget N/A rule).
	 */
	interface Props extends TpWidgetProps {
		/** Test seam: a throwaway Dexie, the way `weather` and `currency` thread one. */
		db?: TpDb | undefined;
	}

	let { instanceId, settings: tileSettings, size, onOpenDetail, db = undefined }: Props = $props();

	const prefs = $derived(readSettings(tileSettings));
	const cryptoSymbols = $derived(symbolsOf(prefs.watchlist, 'crypto'));

	/** A string, so the subscription effect below re-runs when the *set* moves
	 *  and not on every render — `cryptoSymbols` is a fresh array each derive. */
	const dataKey = $derived(cryptoSymbols.length === 0 ? '' : tickerKey(cryptoSymbols));

	let handle = $state.raw<TpSwrHandle<TpTickerReading> | null>(null);

	// `untrack` is mandatory: `swr()` reads its dedupe map and then writes to it,
	// so a tracked call self-invalidates into `effect_update_depth_exceeded`.
	$effect(() => {
		const key = dataKey;
		const source = untrack(() => (key === '' ? null : cryptoSource(cryptoSymbols, db)));
		handle = source;
		return () => {
			source?.release();
			handle = null;
		};
	});

	/*
	 * doc 06 §7: `interval 60 s, visibleOnly`. The manifest row and this call are
	 * the same two facts and must not drift.
	 *
	 * `untrack` because `useRefresh` snapshots its id on purpose — its effect has
	 * no dependencies and registers once per mount — and reading a prop straight
	 * into it warns about capturing an initial value. That capture is the
	 * intention here, and saying so is better than a warning that reads as a bug.
	 */
	const taskId = untrack(() => instanceId);

	useRefresh(
		taskId,
		{ kind: 'interval', everyMs: 60_000, visibleOnly: true },
		async () => {
			await handle?.revalidate('scheduler');
		},
		{ label: 'markets:ticker', runOnRegister: false }
	);

	const status = $derived(handle?.status ?? 'loading');
	const reading = $derived(handle?.data);
	const payload = $derived(reading?.payload);

	/** The Worker's own staleness, which `swr` cannot see (doc 11 §4). */
	const servedStale = $derived(reading?.meta.stale === true);

	let now = $state(Date.now());
	$effect(() => {
		// Keeps the age line honest on a deck left open, and is what lets the host
		// badge carry finished text instead of a timestamp.
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	const ageLine = $derived(
		handle?.cachedAt === undefined ? '' : fmtRelative(handle.cachedAt, settings.locale, now)
	);

	const rows = $derived(rowsFor(prefs.watchlist, cryptoLookup(payload)));
	const isEmpty = $derived(prefs.watchlist.length === 0);
	const hasAnyQuote = $derived(rows.some((row) => row.quote !== null));

	/** doc 09 §1's per-asset precision, applied through `Intl` rather than by
	 *  hand so a Vietnamese reader gets Vietnamese grouping. */
	function priceText(price: number): string {
		return fmtPrice(price, settings.locale, priceDigits(price));
	}

	function retry(): void {
		void handle?.revalidate('retry');
	}

	/** doc 13 §7's badge, published to the host header (doc 13 §3). */
	const badge = $derived.by<TpTileStatus | null>(() => {
		if (reading === undefined) return null;
		if (status === 'offline') return { kind: 'offline', age: '', retry: null };
		if (status === 'stale-error' || status === 'rate-limited') {
			return { kind: 'stale-error', age: ageLine, retry };
		}
		if (status === 'stale' || servedStale) return { kind: 'stale', age: ageLine, retry: null };
		return null;
	});

	$effect(() => {
		const next = badge;
		untrack(() => setTileStatus(instanceId, next));
	});

	// Teardown only — no tracked reads, so this runs once and its cleanup is the
	// unmount. Folded into the effect above it would turn each heartbeat into a
	// delete and an insert.
	$effect(() => {
		const id = untrack(() => instanceId);
		return () => setTileStatus(id, null);
	});

	/** doc 13 §3's tier L adds a secondary line; below it the footer would eat a
	 *  row the list needs more. */
	const roomy = $derived(size.tier === 'L');
</script>

{#if isEmpty}
	<!-- doc 06 §3's `empty`: first-run guidance with exactly one action. -->
	<div class="tp-mk-empty">
		<p class="tp-mk-empty__title">{m['widget.markets.no_rows']()}</p>
		{#if onOpenDetail}
			<button type="button" class="tp-mk-empty__action" onclick={() => onOpenDetail?.()}>
				{m['widget.markets.no_rows_hint']()}
			</button>
		{:else}
			<p class="tp-mk-empty__hint">{m['widget.markets.no_rows_hint']()}</p>
		{/if}
	</div>
{:else if status === 'loading' || status === 'idle'}
	<!-- doc 12 §7: skeleton blocks, never a spinner. One bar per watched row, so
	     the tile does not resize when the answer arrives. -->
	<div class="tp-mk-skeleton" aria-label={m['widget.markets.loading']()}>
		{#each prefs.watchlist as entry (entry.kind + entry.symbol)}
			<div class="tp-mk-skeleton__row"></div>
		{/each}
	</div>
{:else if !hasAnyQuote && (status === 'error' || status === 'offline' || status === 'rate-limited')}
	<!-- Inline, never blank (doc 13 §7). Only when there is nothing underneath:
	     a tile still holding prices through a failure keeps them and says so
	     through the host badge instead. -->
	<div class="tp-mk-error">
		<TpIcon name="chart" size={20} />
		<p class="tp-mk-error__text">
			{#if status === 'offline'}
				{m['widget.markets.offline']()}
			{:else if status === 'rate-limited'}
				{m['widget.markets.rate_limited']()}
			{:else}
				{m['widget.markets.error']()}
			{/if}
		</p>
		<button type="button" class="tp-mk-error__retry" onclick={retry}>
			{m['common.retry']()}
		</button>
	</div>
{:else}
	<ul class="tp-mk-list" aria-label={m['widget.markets.list_label']()}>
		{#each rows as row (row.entry.kind + row.entry.symbol)}
			<li class="tp-mk-row">
				<span class="tp-mk-row__label">{row.label}</span>

				{#if row.quote === null}
					<span
						class="tp-mk-row__absent"
						title={m['widget.markets.unavailable_hint']({ symbol: row.entry.symbol })}
					>
						{m['widget.markets.unavailable']()}
					</span>
				{:else}
					<span class="tp-mk-row__price tp-num">{priceText(row.quote.price)}</span>
					{#if row.quote.change24h === null}
						<span class="tp-mk-row__flat" title={m['widget.markets.no_change']()}>—</span>
					{:else}
						<!-- doc 12 §4.2: `Intl` places the sign before the colour is
						     applied, so colour reinforces rather than carries. -->
						<span
							class="tp-mk-row__change tp-num"
							class:tp-mk-row__change--up={row.quote.change24h > 0}
							class:tp-mk-row__change--down={row.quote.change24h < 0}
							aria-label={m['widget.markets.change_label']({
								change: fmtPercentChange(row.quote.change24h, settings.locale)
							})}
						>
							{fmtPercentChange(row.quote.change24h, settings.locale)}
						</span>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>

	{#if roomy && ageLine !== ''}
		<p class="tp-mk-foot">{m['widget.markets.as_of']({ age: ageLine })}</p>
	{/if}
{/if}

<style>
	.tp-mk-list {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.125rem;
		overflow-y: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-mk-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.125rem 0;
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.tp-mk-row__label {
		overflow: hidden;
		flex: 1;
		color: var(--color-fg-mute);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mk-row__price {
		color: var(--color-fg);
	}

	.tp-mk-row__change {
		min-width: 4.25rem;
		color: var(--color-fg-mute);
		text-align: right;
	}

	.tp-mk-row__change--up {
		color: var(--color-up);
	}

	.tp-mk-row__change--down {
		color: var(--color-down);
	}

	.tp-mk-row__flat,
	.tp-mk-row__absent {
		min-width: 4.25rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		text-align: right;
	}

	.tp-mk-foot {
		margin: 0.25rem 0 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mk-skeleton {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.375rem;
		padding-top: 0.25rem;
	}

	.tp-mk-skeleton__row {
		height: 0.875rem;
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
	}

	.tp-mk-empty,
	.tp-mk-error {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.375rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-mk-empty__title,
	.tp-mk-empty__hint,
	.tp-mk-error__text {
		margin: 0;
	}

	.tp-mk-empty__action,
	.tp-mk-error__retry {
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-accent);
		cursor: pointer;
		font: inherit;
		padding-block: 0.125rem;
		padding-inline: 0;
		text-align: left;
	}

	.tp-mk-empty__action:focus-visible,
	.tp-mk-error__retry:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
</style>
