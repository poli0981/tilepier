<script lang="ts">
	import { untrack } from 'svelte';
	import { useRefresh } from '$lib/core/refresh.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import { setTileStatus, type TpTileStatus } from '$lib/core/tile-status';
	import { tileView } from '$lib/core/tile-view';
	import type { TpWidgetProps } from '$lib/core/types';
	import { changeDirection, fmtPercentChange, fmtPrice, fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		atClose,
		cryptoSide,
		cryptoSource,
		entryId,
		oldestAt,
		peekSparkline,
		priceDigits,
		readSettings,
		removeFromWatchlist,
		rowsFor,
		sparklinePoints,
		stockQuotesKey,
		stockSide,
		stockSource,
		symbolsOf,
		tickerKey,
		tileBadge,
		type TpSide,
		type TpStockReading,
		type TpTickerReading
	} from './service';
	import type { TpWatchEntry } from './types';

	/**
	 * doc 09 §1's tile: watchlist rows, each a symbol, a last price and a change
	 * chip — over 24 h for a coin, on the day for a stock.
	 *
	 * **Tier S does not exist here.** `min` is 2×2 and doc 13 §3's tier S is
	 * `w <= 2 && h <= 1`, so nothing this widget can be resized to reaches it —
	 * one tier fewer than `currency` had to build, named rather than left as a
	 * gap in the DoD. A watchlist is a list, and a list has no honest one-line
	 * rendering.
	 *
	 * **Two sources, two scheduler entries.** The crypto set comes from Binance.US
	 * and the stock set from Finnhub, each under its own data key, and each is
	 * registered under the *instance* rather than under that key — a deviation
	 * from doc 04 §3's rule for networked widgets that `multiInstance: false`
	 * makes safe, and that lets the cadence outlive every watchlist edit (the
	 * keys move with the set; the instance does not). Two entries rather than
	 * one running both, because the scheduler owns backoff per entry: one entry
	 * would slow the coins down every time Finnhub had a bad minute.
	 *
	 * **States (doc 06 §3).** `markets` is doc 17 §3's cached-data class, so all
	 * seven are required, and with two sources they are decided by `core/tile-view`
	 * rather than read off one handle: the list as soon as either side has
	 * quotes, the skeleton while neither has and one is still asking, the most
	 * telling failure after that. A side that has not answered says so in its own
	 * rows. `stale` and `stale-error` leave through `core/tile-status` to the host
	 * header (doc 13 §7). `empty` is an empty watchlist. `permission-needed` is
	 * **forbidden**: the manifest declares no `permissions` (doc 06 §3's
	 * single-widget N/A rule).
	 */
	interface Props extends TpWidgetProps {
		/** Test seam: a throwaway Dexie, the way `weather` and `currency` thread one. */
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
	const cryptoSymbols = $derived(symbolsOf(prefs.watchlist, 'crypto'));
	const stockSymbols = $derived(symbolsOf(prefs.watchlist, 'stock'));

	/** Strings, so each subscription effect re-runs when its *set* moves and not
	 *  on every render — the symbol lists are fresh arrays each derive. */
	const cryptoKey = $derived(cryptoSymbols.length === 0 ? '' : tickerKey(cryptoSymbols));
	const stockKey = $derived(stockSymbols.length === 0 ? '' : stockQuotesKey(stockSymbols));

	let cryptoHandle = $state.raw<TpSwrHandle<TpTickerReading> | null>(null);
	let stockHandle = $state.raw<TpSwrHandle<TpStockReading> | null>(null);

	// `untrack` is mandatory: `swr()` reads its dedupe map and then writes to it,
	// so a tracked call self-invalidates into `effect_update_depth_exceeded`.
	$effect(() => {
		const key = cryptoKey;
		const source = untrack(() => (key === '' ? null : cryptoSource(cryptoSymbols, db)));
		cryptoHandle = source;
		return () => {
			source?.release();
			cryptoHandle = null;
		};
	});

	$effect(() => {
		const key = stockKey;
		const source = untrack(() => (key === '' ? null : stockSource(stockSymbols, db)));
		stockHandle = source;
		return () => {
			source?.release();
			stockHandle = null;
		};
	});

	/*
	 * doc 06 §7: `interval 60 s, visibleOnly`. The manifest row and these calls
	 * are the same two facts and must not drift.
	 *
	 * `untrack` because `useRefresh` snapshots its id on purpose — its effect has
	 * no dependencies and registers once per mount — and reading a prop straight
	 * into it warns about capturing an initial value. That capture is the
	 * intention here, and saying so is better than a warning that reads as a bug.
	 */
	const taskId = untrack(() => instanceId);
	const CADENCE = { kind: 'interval', everyMs: 60_000, visibleOnly: true } as const;

	useRefresh(
		taskId,
		CADENCE,
		async () => {
			await cryptoHandle?.revalidate('scheduler');
		},
		{ label: 'markets:ticker', runOnRegister: false }
	);

	useRefresh(
		`${taskId}:stock`,
		CADENCE,
		async () => {
			await stockHandle?.revalidate('scheduler');
		},
		{ label: 'markets:stock', runOnRegister: false }
	);

	const cryptoView = $derived(cryptoHandle === null ? null : cryptoSide(cryptoHandle));
	const stockView = $derived(stockHandle === null ? null : stockSide(stockHandle));

	/** Only the sides this watchlist uses: a handle exists exactly when its kind
	 *  has a row, so a stock-only list is judged on the stock side alone. */
	const sides = $derived([cryptoView, stockView].filter((side): side is TpSide => side !== null));

	const view = $derived(tileView(sides));
	const rows = $derived(rowsFor(prefs.watchlist, { crypto: cryptoView, stock: stockView }));
	const isEmpty = $derived(prefs.watchlist.length === 0);

	let now = $state(Date.now());
	$effect(() => {
		// Keeps the age line honest on a deck left open, and is what lets the host
		// badge carry finished text instead of a timestamp.
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	function ageOf(at: number | undefined): string {
		return at === undefined ? '' : fmtRelative(at, settings.locale, now);
	}

	const ageLine = $derived(ageOf(oldestAt(sides)));

	/** doc 09 §1's per-asset precision, applied through `Intl` rather than by
	 *  hand so a Vietnamese reader gets Vietnamese grouping. */
	function priceText(price: number): string {
		return fmtPrice(price, settings.locale, priceDigits(price));
	}

	/** Both sides, because the reader pressed one button. A refusal lands in the
	 *  side's own status, which is what the tile renders from — so the rejection
	 *  itself has nowhere further to go. */
	function retry(): void {
		void cryptoHandle?.revalidate('retry').catch(() => undefined);
		void stockHandle?.revalidate('retry').catch(() => undefined);
	}

	/** doc 09 §1: "delisted symbol → row error chip with remove shortcut". */
	function remove(entry: TpWatchEntry): void {
		onUpdateSettings?.({
			watchlist: removeFromWatchlist(prefs.watchlist, entry.kind, entry.symbol)
		});
	}

	/** doc 13 §7's badge, published to the host header (doc 13 §3). */
	const badge = $derived.by<TpTileStatus | null>(() => {
		const worst = tileBadge(sides);
		if (worst === null) return null;
		if (worst.kind === 'offline') return { kind: 'offline', age: '', retry: null };
		if (worst.kind === 'stale-error') {
			return { kind: 'stale-error', age: ageOf(worst.cachedAt), retry };
		}
		return { kind: 'stale', age: ageOf(worst.cachedAt), retry: null };
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

	/* ────────────────────────────────────────── the sparkline (doc 09 §1) */

	/** doc 09 §1 puts it at `w >= 3`; below that the row is label, price and
	 *  chip, and a 40 px picture would push one of the three off the end. */
	const showSpark = $derived(size.w >= 3);

	const SPARK_W = 40;
	const SPARK_H = 12;

	/** Keyed by `entryId`: the symbol alone is not unique on a mixed watchlist. */
	let sparks = $state.raw<Record<string, number[]>>({});

	/**
	 * **A read, never a fetch.** doc 11 §5 keeps series out of the tile's request
	 * path entirely — that is what makes the Twelve Data quota model hold — so
	 * this peeks `apiCache` and subscribes to nothing. The consequence is that a
	 * sparkline is absent until the reader has opened that symbol's detail once,
	 * and absent is an ordinary state rather than a fault.
	 *
	 * Keyed on the watchlist and on both sides' `cachedAt`, so it re-reads when
	 * new candles could have landed and not on every render.
	 */
	$effect(() => {
		if (!showSpark) {
			sparks = {};
			return;
		}

		const entries = prefs.watchlist;
		void cryptoHandle?.cachedAt;
		void stockHandle?.cachedAt;

		let live = true;
		void untrack(async () => {
			const next: Record<string, number[]> = {};
			for (const entry of entries) {
				next[entryId(entry)] = await peekSparkline(entry, Date.now(), db);
			}
			if (live) sparks = next;
		});

		return () => {
			live = false;
		};
	});
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
{:else if view === 'loading'}
	<!-- doc 12 §7: skeleton blocks, never a spinner. One bar per watched row, so
	     the tile does not resize when the answer arrives. -->
	<div class="tp-mk-skeleton" aria-label={m['widget.markets.loading']()}>
		{#each prefs.watchlist as entry (entryId(entry))}
			<div class="tp-mk-skeleton__row"></div>
		{/each}
	</div>
{:else if view !== 'list'}
	<!-- Inline, never blank (doc 13 §7). Only when neither side has anything to
	     show: a tile still holding prices through a failure keeps them and says
	     so through the host badge instead. -->
	<div class="tp-mk-error">
		<TpIcon name="chart" size={20} />
		<p class="tp-mk-error__text">
			{#if view === 'offline'}
				{m['widget.markets.offline']()}
			{:else if view === 'rate-limited'}
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
		{#each rows as row (entryId(row.entry))}
			{@const id = entryId(row.entry)}
			<li class="tp-mk-row">
				<span class="tp-mk-row__label">{row.label}</span>

				{#if row.state.kind === 'quoted'}
					{@const quote = row.state.quote}
					{#if atClose(row.entry.kind, quote, now)}
						<span
							class="tp-mk-row__tag"
							title={m['widget.markets.at_close_hint']({ age: ageOf(quote.at) })}
						>
							{m['widget.markets.at_close']()}
						</span>
					{/if}
					<span class="tp-mk-row__price tp-num">{priceText(quote.price)}</span>
					{#if showSpark && (sparks[id]?.length ?? 0) > 1}
						<svg
							class="tp-mk-row__spark"
							viewBox="0 0 {SPARK_W} {SPARK_H}"
							width={SPARK_W}
							height={SPARK_H}
							aria-hidden="true"
							focusable="false"
						>
							<polyline
								points={sparklinePoints(sparks[id] ?? [], SPARK_W, SPARK_H)}
								fill="none"
								stroke="currentColor"
								stroke-width="1"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					{/if}
					{#if quote.change === null}
						<span class="tp-mk-row__flat" title={m['widget.markets.no_change']()}>—</span>
					{:else}
						{@const change = fmtPercentChange(quote.change, settings.locale)}
						{@const direction = changeDirection(quote.change, settings.locale)}
						<!-- doc 12 §4.2: `Intl` places the sign before the colour is
						     applied, so colour reinforces rather than carries. -->
						<span
							class="tp-mk-row__change tp-num"
							class:tp-mk-row__change--up={direction === 'up'}
							class:tp-mk-row__change--down={direction === 'down'}
							aria-label={row.entry.kind === 'stock'
								? m['widget.markets.change_label_day']({ change })
								: m['widget.markets.change_label']({ change })}
						>
							{change}
						</span>
					{/if}
				{:else if row.state.kind === 'absent'}
					<span
						class="tp-mk-row__absent"
						title={m['widget.markets.unavailable_hint']({ symbol: row.entry.symbol })}
					>
						{m['widget.markets.unavailable']()}
					</span>
					{#if onUpdateSettings}
						<button
							type="button"
							class="tp-mk-row__remove"
							aria-label={m['widget.markets.remove_row']({ symbol: row.entry.symbol })}
							onclick={() => remove(row.entry)}
						>
							<TpIcon name="trash" size={14} />
						</button>
					{/if}
				{:else if row.state.kind === 'waiting'}
					<span class="tp-mk-row__waiting" role="img" aria-label={m['widget.markets.loading']()}
					></span>
				{:else}
					<span class="tp-mk-row__absent" title={m['widget.markets.error']()}>
						{m['widget.markets.row_unread']()}
					</span>
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

	/* doc 09 §1's "as of close". Beside the price it qualifies, and dim: it is a
	   footnote to the number rather than a second number. */
	.tp-mk-row__tag {
		flex: none;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mk-row__price {
		color: var(--color-fg);
	}

	/* `aria-hidden`: the price and the signed change beside it already say
	   everything this shape does, and a screen reader has no use for a polyline. */
	.tp-mk-row__spark {
		overflow: visible;
		color: var(--color-fg-dim);
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

	/* One row still on its way while the other side has answered: the skeleton
	   idiom (doc 12 §7) at the width of the price it stands in for. */
	.tp-mk-row__waiting {
		width: 4.25rem;
		height: 0.75rem;
		align-self: center;
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
	}

	.tp-mk-row__remove {
		display: inline-flex;
		align-self: center;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg-dim);
		cursor: pointer;
		padding: 0.125rem;
	}

	.tp-mk-row__remove:hover {
		color: var(--color-fg);
	}

	.tp-mk-row__remove:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
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
