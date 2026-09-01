<script lang="ts">
	import { untrack } from 'svelte';
	import { CRYPTO_RANGES, CRYPTO_RANGE_DEFAULT, type TpCryptoRange } from '$lib/api-types';
	import TpChart from '$lib/charts/TpChart.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtPercentChange, fmtPrice } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import { candleSummary, candlestickOption } from './chart';
	import {
		cryptoLookup,
		cryptoSource,
		klinesSource,
		labelOf,
		priceDigits,
		readSettings,
		symbolsOf,
		type TpKlinesReading,
		type TpTickerReading
	} from './service';

	/**
	 * doc 09 §1's detail: a symbol header, candles with a volume band, and the
	 * range presets.
	 *
	 * **No `useRefresh` here**, for the reason `TpCurrencyDetail.svelte` gives:
	 * a panel is open for seconds at a time, and registering a cadence would put
	 * a row in the diagnostics table for a task that will not come due. `swr`'s
	 * own hydrate-then-revalidate-if-stale on subscribe is the whole refresh
	 * story a panel needs — and here it is a *better* one than a cadence, because
	 * switching range re-subscribes and that is exactly when new candles matter.
	 *
	 * **`MAX` is absent from the range picker**, which is Week 5's one approved
	 * depth cut (doc 23 §Week 5). 1Y tells an honest story; `MAX` only reaches
	 * for Twelve Data's EOD depth, which is the most expensive thing in the
	 * quota model and buys a longer axis rather than a different answer.
	 */
	interface Props extends TpDetailProps {
		/** Test seam, as on the tile: a throwaway Dexie rather than the reader's. */
		db?: TpDb | undefined;
	}

	let { settings: tileSettings, db = undefined }: Props = $props();

	const prefs = $derived(readSettings(tileSettings));
	const cryptoSymbols = $derived(symbolsOf(prefs.watchlist, 'crypto'));

	/**
	 * Which symbol the panel is showing.
	 *
	 * Local rather than persisted: doc 05 §2 keeps tile settings for what a
	 * reader arranged, and "the row I clicked last" is not that — it would make
	 * the tile's stored bag change every time somebody looked at a chart.
	 */
	let picked = $state<string | null>(null);
	const symbol = $derived(picked ?? cryptoSymbols[0] ?? null);

	let range = $state<TpCryptoRange>(CRYPTO_RANGE_DEFAULT);

	const entry = $derived(prefs.watchlist.find((e) => e.symbol === symbol) ?? null);
	const label = $derived(entry === null ? (symbol ?? '') : labelOf(entry));

	/* ─────────────────────────────────────────────────────────── the quote */

	const tickerKeyed = $derived(cryptoSymbols.join(','));
	let ticker = $state.raw<TpSwrHandle<TpTickerReading> | null>(null);

	// `untrack` for the reason doc 06 §5 rule 7 gives: `swr()` reads its dedupe
	// map and then writes to it, and that map is a `SvelteMap`.
	$effect(() => {
		const keyed = tickerKeyed;
		const source = untrack(() => (keyed === '' ? null : cryptoSource(cryptoSymbols, db)));
		ticker = source;
		return () => {
			source?.release();
			ticker = null;
		};
	});

	const quote = $derived(entry === null ? null : cryptoLookup(ticker?.data?.payload)(entry));

	/* ────────────────────────────────────────────────────────── the candles */

	let candlesHandle = $state.raw<TpSwrHandle<TpKlinesReading> | null>(null);

	$effect(() => {
		const current = symbol;
		const window = range;
		if (current === null) {
			candlesHandle = null;
			return;
		}

		const source = untrack(() => klinesSource(current, window, db));
		candlesHandle = source;
		return () => {
			source.release();
			candlesHandle = null;
		};
	});

	const candles = $derived(candlesHandle?.data?.payload.candles ?? []);
	const candleStatus = $derived(candlesHandle?.status ?? 'loading');
	const summary = $derived(candleSummary(candles));

	const digits = $derived(priceDigits(quote?.price ?? candles.at(-1)?.[4] ?? 1));

	function priceText(value: number): string {
		return fmtPrice(value, settings.locale, digits);
	}

	const RANGE_LABELS: Record<TpCryptoRange, () => string> = {
		'1D': () => m['widget.markets.range_1d'](),
		'1W': () => m['widget.markets.range_1w'](),
		'1M': () => m['widget.markets.range_1m'](),
		'1Y': () => m['widget.markets.range_1y']()
	};

	const option = $derived(
		candlestickOption(candles, {
			formatPrice: priceText,
			volumeLabel: m['widget.markets.volume']()
		})
	);

	/** doc 13 §8: every ECharts view is paired with an accessible summary line,
	 *  and it carries the same facts the picture does. */
	const summaryLine = $derived(
		summary === null || symbol === null
			? m['widget.markets.chart_empty']()
			: m['widget.markets.chart_summary']({
					symbol: label,
					range: RANGE_LABELS[range](),
					change: fmtPercentChange(summary.change, settings.locale),
					open: priceText(summary.open),
					close: priceText(summary.close),
					low: priceText(summary.low),
					high: priceText(summary.high)
				})
	);

	const attribution = $derived(
		candlesHandle?.data?.payload.attribution ?? ticker?.data?.payload.attribution ?? ''
	);
</script>

<div class="tp-mkd">
	{#if symbol === null}
		<p class="tp-mkd__empty">{m['widget.markets.nothing_selected']()}</p>
	{:else}
		<header class="tp-mkd__head">
			<div class="tp-mkd__ident">
				<h3 class="tp-mkd__symbol">{label}</h3>
				{#if cryptoSymbols.length > 1}
					<label class="tp-mkd__pick">
						<span class="tp-mkd__pick-label">{m['widget.markets.symbol_label']()}</span>
						<select bind:value={picked}>
							{#each prefs.watchlist as row (row.kind + row.symbol)}
								<option value={row.symbol}>{labelOf(row)}</option>
							{/each}
						</select>
					</label>
				{/if}
			</div>

			{#if quote !== null}
				<div class="tp-mkd__figures">
					<span class="tp-mkd__price tp-num">{priceText(quote.price)}</span>
					{#if quote.change24h !== null}
						<span
							class="tp-mkd__change tp-num"
							class:tp-mkd__change--up={quote.change24h > 0}
							class:tp-mkd__change--down={quote.change24h < 0}
						>
							{fmtPercentChange(quote.change24h, settings.locale)}
						</span>
					{/if}
					{#if quote.low24h !== null && quote.high24h !== null}
						<span class="tp-mkd__band tp-num">
							{m['widget.markets.day_range']({
								low: priceText(quote.low24h),
								high: priceText(quote.high24h)
							})}
						</span>
					{/if}
				</div>
			{/if}
		</header>

		<fieldset class="tp-mkd__ranges">
			<legend class="tp-mkd__ranges-legend">{m['widget.markets.range_label']()}</legend>
			{#each Object.keys(CRYPTO_RANGES) as key (key)}
				<button
					type="button"
					class="tp-mkd__range"
					class:tp-mkd__range--on={range === key}
					aria-pressed={range === key}
					onclick={() => (range = key as TpCryptoRange)}
				>
					{RANGE_LABELS[key as TpCryptoRange]()}
				</button>
			{/each}
		</fieldset>

		{#if candles.length > 0}
			<TpChart
				{option}
				summary={summaryLine}
				loadingLabel={m['widget.markets.chart_loading']()}
				failedLabel={m['widget.markets.chart_failed']()}
				height={280}
			/>
		{:else if candleStatus === 'offline'}
			<p class="tp-mkd__note">{m['widget.markets.detail_offline']()}</p>
		{:else if candleStatus === 'error' || candleStatus === 'stale-error'}
			<p class="tp-mkd__note">{m['widget.markets.detail_error']()}</p>
		{:else if candleStatus === 'loading' || candleStatus === 'idle'}
			<p class="tp-mkd__note">{m['widget.markets.chart_loading']()}</p>
		{:else}
			<p class="tp-mkd__note">{m['widget.markets.chart_empty']()}</p>
		{/if}

		<footer class="tp-mkd__foot">
			<!-- doc 16 §4: permanent, not conditional on anything. -->
			<p class="tp-mkd__disclaimer">{m['widget.markets.disclaimer']()}</p>
			{#if attribution !== ''}
				<p class="tp-mkd__credit">{attribution}</p>
			{/if}
		</footer>
	{/if}
</div>

<style>
	.tp-mkd {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.tp-mkd__head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.tp-mkd__ident {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.tp-mkd__symbol {
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-lg);
	}

	.tp-mkd__pick {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-mkd__figures {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.tp-mkd__price {
		color: var(--color-fg);
		font-size: var(--text-lg);
	}

	.tp-mkd__change {
		color: var(--color-fg-mute);
		font-size: var(--text-sm);
	}

	.tp-mkd__change--up {
		color: var(--color-up);
	}

	.tp-mkd__change--down {
		color: var(--color-down);
	}

	.tp-mkd__band {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mkd__ranges {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border: 0;
		margin: 0;
		padding: 0;
	}

	.tp-mkd__ranges-legend {
		padding: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mkd__range {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		padding-block: 0.25rem;
		padding-inline: 0.5rem;
	}

	.tp-mkd__range--on {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.tp-mkd__range:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.tp-mkd__note,
	.tp-mkd__empty {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-mkd__foot {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		border-top: 1px solid var(--color-ink-700);
		padding-top: 0.5rem;
	}

	.tp-mkd__disclaimer,
	.tp-mkd__credit {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
