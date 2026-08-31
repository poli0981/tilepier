<script lang="ts">
	import { untrack } from 'svelte';
	import { FX_HISTORY_DAYS, FX_HISTORY_DEFAULT_DAYS } from '$lib/api-types';
	import TpChart from '$lib/charts/TpChart.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtCurrency, fmtPercentChange, fmtRate } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		change24h,
		convert,
		currencyCodes,
		fxSource,
		historyDepth,
		historyPoints,
		historySource,
		historySummary,
		HISTORY_MIN_POINTS,
		rateFor,
		readSettings,
		type TpFxReading,
		type TpHistoryReading
	} from './service';
	import { historyOption } from './chart';
	import { MAX_TARGETS } from './types';

	/**
	 * doc 08 §2's detail: a multi-row converter and a rate table with the 24 h
	 * change.
	 *
	 * The table is wide-and-shallow — one base amount against many currencies —
	 * which is exactly the shape `/api/fx`'s `prevRates` was added for. Covering
	 * these rows through `/api/fx/history` instead would be one request per row.
	 *
	 * **No `useRefresh` here.** A 12 h cadence on a panel open for thirty seconds
	 * can never come due, and registering it would put a row in the diagnostics
	 * table for a task that will not run — the same objection
	 * `core/refresh.svelte.ts` already makes about `manual`. `swr`'s own
	 * hydrate-then-revalidate-if-stale on subscribe is the whole refresh story a
	 * panel needs.
	 */
	interface Props extends TpDetailProps {
		/** Test seam, as on the tile: a throwaway Dexie rather than the reader's. */
		db?: TpDb | undefined;
	}

	let { settings: tileSettings, onUpdateSettings, db = undefined }: Props = $props();

	const prefs = $derived(readSettings(tileSettings));

	let handle = $state.raw<TpSwrHandle<TpFxReading> | null>(null);

	$effect(() => {
		// `untrack` for the reason doc 06 §5 rule 7 gives: `swr()` reads its dedupe
		// map and then writes to it, and that map is a `SvelteMap`.
		const source = untrack(() => fxSource(db));
		handle = source;
		return () => {
			// The tile behind this panel holds the same key, so releasing here only
			// drops this subscriber — the entry survives on its refcount.
			source.release();
			handle = null;
		};
	});

	const status = $derived(handle?.status ?? 'loading');
	const reading = $derived(handle?.data);
	const payload = $derived(reading?.payload);

	const codes = $derived(currencyCodes(payload, prefs.base, ...prefs.targets));
	const addable = $derived(codes.filter((code) => !prefs.targets.includes(code)));

	/** doc 08 §2's change column exists only once a second day has been
	 *  recorded. Absent, not zero — a 0.00 % is a claim about the market. */
	const changeDate = $derived(payload?.prevDate ?? null);

	const rows = $derived(
		payload === undefined
			? []
			: prefs.targets.map((code) => ({
					code,
					rate: rateFor(payload, prefs.base, code),
					amount: convert(payload, prefs.amount, prefs.base, code),
					change: changeDate === null ? null : change24h(payload, prefs.base, code)
				}))
	);

	const attribution = $derived(payload?.attribution ?? '');

	function retry(): void {
		void handle?.revalidate('retry');
	}

	function setAmount(raw: string): void {
		const value = Number(raw);
		if (raw.trim() === '' || !Number.isFinite(value) || value < 0) return;
		onUpdateSettings?.({ amount: value });
	}

	function setBase(code: string): void {
		onUpdateSettings?.({ base: code });
	}

	function addRow(code: string): void {
		if (code === '' || prefs.targets.includes(code)) return;
		if (prefs.targets.length >= MAX_TARGETS) return;
		onUpdateSettings?.({ targets: [...prefs.targets, code] });
	}

	function removeRow(code: string): void {
		onUpdateSettings?.({ targets: prefs.targets.filter((entry) => entry !== code) });
	}

	/** Reorder by swapping with the neighbour, which is the whole of doc 08 §2's
	 *  "reorder" for a list this short — and it needs no drag surface, so it
	 *  works from the keyboard without anything extra. */
	function move(code: string, by: -1 | 1): void {
		const from = prefs.targets.indexOf(code);
		const to = from + by;
		if (from === -1 || to < 0 || to >= prefs.targets.length) return;

		const next = [...prefs.targets];
		const moved = next[from] as string;
		next[from] = next[to] as string;
		next[to] = moved;
		onUpdateSettings?.({ targets: next });
	}

	let pending = $state('');

	/* ───────────────────────────────────────────────────── doc 08 §2's history */

	/**
	 * The window, in days. A viewing choice rather than a setting, so it lives
	 * here and not in `tp.layout.v1` — reopening the panel starts at doc 10 §3's
	 * ninety again, which is the range the reader most often wants.
	 */
	let days = $state<number>(FX_HISTORY_DEFAULT_DAYS);

	let history = $state.raw<TpSwrHandle<TpHistoryReading> | null>(null);

	/**
	 * Re-subscribes when the pair or the window changes.
	 *
	 * Tracked reads first, then `untrack` around `historySource` — `swr()` reads
	 * its dedupe map and writes to it, so a tracked call self-invalidates. This
	 * needs no `{#key}` wrapper the way weather's tile does, and the reason is
	 * worth keeping: that dance exists because `useRefresh` snapshots its id, and
	 * there is no `useRefresh` here. **If one is ever added, the subscription and
	 * the registration have to be rebuilt in one motion** — which means moving
	 * both into a child component under `{#key}`.
	 */
	$effect(() => {
		const base = prefs.base;
		const quote = prefs.quote;
		const range = days;

		const source = untrack(() => historySource(base, quote, range, db));
		history = source;
		return () => {
			source.release();
			history = null;
		};
	});

	/**
	 * Fixed at mount. The window is a run of calendar days and the panel is open
	 * for seconds, so a heartbeat would redraw the chart to say the same thing.
	 */
	const openedAt = Date.now();

	const historyPayload = $derived(history?.data?.payload);
	const points = $derived(
		historyPayload === undefined ? [] : historyPoints(historyPayload, days, openedAt)
	);
	const depth = $derived(historyDepth(points));
	const option = $derived(historyOption(points));

	/** doc 13 §8: every chart is paired with an accessible summary line. */
	const chartSummary = $derived.by(() => {
		const summary = historySummary(points);
		if (summary === null) return '';

		return m['widget.currency.chart_summary']({
			base: prefs.base,
			quote: prefs.quote,
			days: String(days),
			change: fmtPercentChange(summary.change, settings.locale),
			low: fmtRate(summary.low, settings.locale),
			high: fmtRate(summary.high, settings.locale)
		});
	});
</script>

<section class="tp-curd" data-testid="currency-detail" data-status={status}>
	{#if reading === undefined}
		{#if status === 'offline'}
			<p class="tp-curd__note" data-testid="currency-detail-offline">
				{m['widget.currency.detail_offline']()}
			</p>
		{:else if status === 'error' || status === 'stale-error' || status === 'rate-limited'}
			<div class="tp-curd__note" role="alert" data-testid="currency-detail-error">
				<p>
					{status === 'rate-limited'
						? m['widget.currency.rate_limited']()
						: m['widget.currency.error']()}
				</p>
				<button type="button" class="tp-curd__retry" onclick={retry}>
					{m['common.retry']()}
				</button>
			</div>
		{:else}
			<p class="tp-curd__note">{m['widget.currency.loading']()}</p>
		{/if}
	{:else}
		<div class="tp-curd__head">
			<input
				class="tp-curd__amount tp-num"
				type="number"
				inputmode="decimal"
				min="0"
				step="any"
				value={prefs.amount}
				aria-label={m['widget.currency.detail_amount']({ base: prefs.base })}
				data-testid="currency-detail-amount"
				oninput={(event) => setAmount(event.currentTarget.value)}
			/>
			<select
				class="tp-curd__code"
				aria-label={m['widget.currency.base_label']()}
				data-testid="currency-detail-base"
				value={prefs.base}
				onchange={(event) => setBase(event.currentTarget.value)}
			>
				{#each codes as code (code)}<option value={code}>{code}</option>{/each}
			</select>
		</div>

		{#if rows.length === 0}
			<p class="tp-curd__note" data-testid="currency-detail-empty">
				{m['widget.currency.no_rows']()}
			</p>
		{:else}
			<table class="tp-curd__table" data-testid="currency-table">
				<thead>
					<tr>
						<th scope="col">{m['widget.currency.col_currency']()}</th>
						<th scope="col" class="tp-curd__right">{m['widget.currency.col_amount']()}</th>
						<th scope="col" class="tp-curd__right">{m['widget.currency.col_rate']()}</th>
						{#if changeDate !== null}
							<th scope="col" class="tp-curd__right" data-testid="currency-change-header">
								{m['widget.currency.col_change']({ date: changeDate })}
							</th>
						{/if}
						<th scope="col"><span class="tp-curd__sr">{m['widget.currency.add_row']()}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row (row.code)}
						<tr data-testid="currency-row-{row.code}">
							<th scope="row">{row.code}</th>
							<td class="tp-curd__right tp-num">
								{row.amount === null
									? m['widget.currency.unavailable']({ code: row.code })
									: fmtCurrency(row.amount, row.code, settings.locale)}
							</td>
							<td class="tp-curd__right tp-num">
								{row.rate === null ? '—' : fmtRate(row.rate, settings.locale)}
							</td>
							{#if changeDate !== null}
								<td
									class="tp-curd__right tp-num"
									data-testid="currency-change-{row.code}"
									data-dir={row.change === null || row.change === 0
										? 'flat'
										: row.change > 0
											? 'up'
											: 'down'}
								>
									{row.change === null ? '—' : fmtPercentChange(row.change, settings.locale)}
								</td>
							{/if}
							<td class="tp-curd__actions">
								<button
									type="button"
									aria-label={m['widget.currency.move_up']({ code: row.code })}
									data-testid="currency-up-{row.code}"
									class="tp-curd__up"
									onclick={() => move(row.code, -1)}
								>
									<TpIcon name="chevron" size={12} />
								</button>
								<button
									type="button"
									aria-label={m['widget.currency.move_down']({ code: row.code })}
									data-testid="currency-down-{row.code}"
									onclick={() => move(row.code, 1)}
								>
									<TpIcon name="chevron" size={12} />
								</button>
								<button
									type="button"
									aria-label={m['widget.currency.remove_row']({ code: row.code })}
									data-testid="currency-remove-{row.code}"
									onclick={() => removeRow(row.code)}
								>
									<TpIcon name="close" size={12} />
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		{#if changeDate === null}
			<p class="tp-curd__hint" data-testid="currency-no-change-yet">
				{m['widget.currency.no_change_yet']()}
			</p>
		{/if}

		<div class="tp-curd__add">
			{#if addable.length === 0 || prefs.targets.length >= MAX_TARGETS}
				<p class="tp-curd__hint">{m['widget.currency.all_added']()}</p>
			{:else}
				<select
					class="tp-curd__code"
					aria-label={m['widget.currency.add_label']()}
					data-testid="currency-add-code"
					bind:value={pending}
				>
					<option value=""></option>
					{#each addable as code (code)}<option value={code}>{code}</option>{/each}
				</select>
				<button
					type="button"
					class="tp-curd__addbtn"
					data-testid="currency-add"
					onclick={() => {
						addRow(pending);
						pending = '';
					}}
				>
					{m['widget.currency.add_row']()}
				</button>
			{/if}
		</div>

		<section class="tp-curd__history" data-testid="currency-history">
			<div class="tp-curd__ranges" role="group" aria-label={m['widget.currency.range_label']()}>
				{#each FX_HISTORY_DAYS as range (range)}
					<button
						type="button"
						class="tp-curd__range"
						aria-pressed={range === days}
						data-testid="currency-range-{range}"
						onclick={() => (days = range)}
					>
						{m['widget.currency.range_days']({ days: String(range) })}
					</button>
				{/each}
			</div>

			{#if depth < HISTORY_MIN_POINTS}
				<!--
					doc 08 §2's honest empty state. Not an empty canvas: a chart drawn
					over three points implies the other eighty-seven were flat, which is
					a claim about the market rather than about what has been recorded.
				-->
				<p class="tp-curd__hint" data-testid="currency-history-building">
					{m['widget.currency.history_building']({
						have: String(depth),
						need: String(HISTORY_MIN_POINTS)
					})}
				</p>
			{:else}
				<h3 class="tp-curd__subhead">
					{m['widget.currency.history_heading']({ base: prefs.base, quote: prefs.quote })}
				</h3>
				<TpChart
					{option}
					summary={chartSummary}
					loadingLabel={m['widget.currency.chart_loading']()}
					failedLabel={m['widget.currency.chart_failed']()}
					height={200}
				/>
			{/if}
		</section>

		<a
			class="tp-curd__credit"
			href="https://www.exchangerate-api.com"
			target="_blank"
			rel="noopener noreferrer"
			data-testid="currency-detail-credit">{attribution}</a
		>
	{/if}
</section>

<style>
	.tp-curd {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.tp-curd__head {
		display: flex;
		gap: 0.375rem;
	}

	.tp-curd__amount {
		flex: 1 1 auto;
		min-width: 0;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-lg);
		padding: 0.25rem 0.5rem;
	}

	.tp-curd__code {
		flex: none;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
		color: var(--color-fg);
		font: inherit;
		padding: 0.25rem 0.375rem;
	}

	.tp-curd__table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-xs);
	}

	.tp-curd__table th,
	.tp-curd__table td {
		border-bottom: 1px solid var(--color-ink-800);
		padding: 0.375rem 0.25rem;
		text-align: left;
	}

	.tp-curd__table thead th {
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		font-weight: 400;
	}

	.tp-curd__right {
		text-align: right;
	}

	/* doc 12 §4.2: never colour alone. The sign is already in the text — Intl
	   puts it there — so the colour is reinforcement rather than the channel. */
	.tp-curd__table td[data-dir='up'] {
		color: var(--color-up);
	}

	.tp-curd__table td[data-dir='down'] {
		color: var(--color-down);
	}

	.tp-curd__up {
		rotate: 180deg;
	}

	.tp-curd__actions {
		display: flex;
		gap: 0.125rem;
		justify-content: flex-end;
	}

	.tp-curd__actions button {
		display: flex;
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		line-height: 1;
		padding: 0.25rem;
	}

	.tp-curd__actions button:hover {
		color: var(--color-beacon);
	}

	.tp-curd__add {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tp-curd__addbtn {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0.25rem 0.625rem;
	}

	.tp-curd__note {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-sm);
	}

	.tp-curd__note p {
		margin: 0;
	}

	.tp-curd__retry {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		padding: 0.125rem 0.5rem;
	}

	.tp-curd__hint {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-curd__history {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tp-curd__ranges {
		display: flex;
		gap: 0.25rem;
	}

	.tp-curd__range {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		padding: 0.125rem 0.5rem;
	}

	/* The selected range is already announced by `aria-pressed`; the tint is
	   reinforcement rather than the only channel (doc 12 §4.2). */
	.tp-curd__range[aria-pressed='true'] {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	.tp-curd__subhead {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		font-weight: 400;
	}

	.tp-curd__credit {
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-curd__sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
