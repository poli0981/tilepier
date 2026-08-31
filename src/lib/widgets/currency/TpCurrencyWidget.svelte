<script lang="ts">
	import { untrack } from 'svelte';
	import { useRefresh } from '$lib/core/refresh.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import { setTileStatus, type TpTileStatus } from '$lib/core/tile-status';
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtCurrency, fmtRate, fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		convert,
		currencyCodes,
		fxKey,
		fxSource,
		mirrorFxSnapshot,
		rateFor,
		readSettings,
		type TpFxReading
	} from './service';

	/**
	 * The currency tile — one editable pair, a converted amount, a rate line
	 * (doc 08 §2).
	 *
	 * **One component, not two.** weather splits into a shell and a readout
	 * because `useRefresh` snapshots its id at mount while `TpGrid.updateTile`
	 * pushes changed props into a mounted host without remounting it, so a
	 * settings change there moves the data key out from under the scheduler.
	 * Here the data key is `fx:v1:USD` whatever the pair is — one cached USD
	 * table answers every pair and the division happens on this side — so
	 * nothing a reader can change moves it, and the `{#key}` dance would guard
	 * against something that cannot happen.
	 *
	 * **States (doc 06 §3).** `currency` is doc 17 §3's cached-data class, so
	 * all seven are required. Five map from `TpSwrStatus`; `stale` and
	 * `stale-error` leave through `core/tile-status` to the host header rather
	 * than being drawn here (doc 13 §7). `empty` is the judgement `swr` cannot
	 * make, and for this widget it is doc 08 §2's dropped-currency case: a table
	 * arrived and cannot answer for this pair. `permission-needed` is
	 * **forbidden** — the manifest declares no `permissions` — and is named here
	 * rather than quietly skipped, per doc 06 §3's single-widget N/A rule.
	 */
	interface Props extends TpWidgetProps {
		/** Test seam: a throwaway Dexie, the way `weather` threads one. */
		db?: TpDb | undefined;
	}

	let {
		instanceId,
		settings: tileSettings,
		size,
		onUpdateSettings,
		db = undefined
	}: Props = $props();

	const prefs = $derived(readSettings(tileSettings));

	let handle = $state.raw<TpSwrHandle<TpFxReading> | null>(null);

	// `untrack` is mandatory: `swr()` reads its dedupe map and then writes to it,
	// so a tracked call self-invalidates into `effect_update_depth_exceeded`.
	$effect(() => {
		const source = untrack(() => fxSource(db));
		handle = source;
		return () => {
			source.release();
			handle = null;
		};
	});

	// The scheduler id is the data key, not the instanceId (doc 04 §3), and the
	// cadence matches the manifest row — both are doc 06 §7's `interval 12 h`
	// and must not drift.
	useRefresh(
		fxKey(),
		{ kind: 'interval', everyMs: 43_200_000 },
		async () => {
			await handle?.revalidate('scheduler');
		},
		{ label: 'currency:fx', runOnRegister: false }
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

	const rate = $derived(payload === undefined ? null : rateFor(payload, prefs.base, prefs.quote));
	const converted = $derived(
		payload === undefined ? null : convert(payload, prefs.amount, prefs.base, prefs.quote)
	);

	/** doc 06 §3's `empty` for this widget: a table arrived and does not quote
	 *  one side of the pair (doc 08 §2's "upstream dropped it"). */
	const unquoted = $derived(
		payload === undefined
			? null
			: rateFor(payload, prefs.base, prefs.base) === null
				? prefs.base
				: rateFor(payload, prefs.quote, prefs.quote) === null || rate === null
					? prefs.quote
					: null
	);

	const codes = $derived(currencyCodes(payload, prefs.base, prefs.quote));

	const heroText = $derived(
		converted === null ? '—' : fmtCurrency(converted, prefs.quote, settings.locale)
	);

	/** At h=1 there is one line, so it carries the whole sentence rather than a
	 *  number with no unit attached to it. */
	const flatText = $derived(
		m['widget.currency.flat_line']({
			amount: fmtRate(prefs.amount, settings.locale),
			base: prefs.base,
			converted: heroText
		})
	);

	const rateLine = $derived(
		rate === null
			? ''
			: m['widget.currency.rate_line']({
					base: prefs.base,
					rate: fmtRate(rate, settings.locale),
					quote: prefs.quote
				})
	);

	const flat = $derived(size.h <= 1);
	const attribution = $derived(payload?.attribution ?? '');

	/**
	 * doc 10 §3's client mirror. Keyed on the payload's own stamp so it writes
	 * once per published day rather than once per render, and driven from the
	 * tile because the tile is what runs on a cadence — the detail is open for
	 * seconds at a time.
	 */
	$effect(() => {
		const current = payload;
		if (current === undefined) return;
		untrack(() => void mirrorFxSnapshot(current, db));
	});

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

	function setPair(next: Partial<{ base: string; quote: string }>): void {
		onUpdateSettings?.(next);
	}

	function swap(): void {
		onUpdateSettings?.({ base: prefs.quote, quote: prefs.base });
	}

	function setAmount(raw: string): void {
		const value = Number(raw);
		// An empty or half-typed field is not a settings change. The reader is
		// mid-keystroke, and writing `NaN` into `tp.layout.v1` would make
		// `readSettings` fail closed on the next mount and silently reset them.
		if (raw.trim() === '' || !Number.isFinite(value) || value < 0) return;
		onUpdateSettings?.({ amount: value });
	}
</script>

<div class="tp-cur" data-testid="currency-tile" data-status={status} data-flat={flat}>
	{#if reading === undefined}
		{#if status === 'offline'}
			<!-- doc 17 §3: cached-data offline with nothing cached is the offline
			     card, not a badge over an empty box. -->
			<p class="tp-cur__note" data-testid="currency-offline">
				{m['widget.currency.offline']()}
			</p>
		{:else if status === 'error' || status === 'stale-error' || status === 'rate-limited'}
			<!-- doc 13 §7: inline, one sentence, a retry. The tile never blanks. -->
			<div class="tp-cur__note" role="alert" data-testid="currency-error">
				<p>
					{status === 'rate-limited'
						? m['widget.currency.rate_limited']()
						: m['widget.currency.error']()}
				</p>
				<button type="button" class="tp-cur__retry" onclick={retry}>
					{m['common.retry']()}
				</button>
			</div>
		{:else}
			<!--
				doc 08 §3: one bar at h=1, not three. Three are 30 of the 34 px a
				one-row tile has, so the loading state would overflow the ready state
				it stands in for.
			-->
			<div class="tp-cur__skeleton" aria-label={m['widget.currency.loading']()}>
				<span></span>
				{#if !flat}<span></span>{/if}
			</div>
		{/if}
	{:else if unquoted !== null}
		<p class="tp-cur__note" data-testid="currency-unquoted">
			{m['widget.currency.unavailable']({ code: unquoted })}
		</p>
	{:else if flat}
		<output class="tp-cur__flat tp-num" data-testid="currency-hero" title={attribution}>
			{flatText}
		</output>
	{:else}
		<div class="tp-cur__pair">
			<input
				class="tp-cur__amount tp-num"
				type="number"
				inputmode="decimal"
				min="0"
				step="any"
				value={prefs.amount}
				aria-label={m['widget.currency.amount_label']()}
				data-testid="currency-amount"
				oninput={(event) => setAmount(event.currentTarget.value)}
			/>
			<select
				class="tp-cur__code"
				aria-label={m['widget.currency.base_label']()}
				data-testid="currency-base"
				value={prefs.base}
				onchange={(event) => setPair({ base: event.currentTarget.value })}
			>
				{#each codes as code (code)}<option value={code}>{code}</option>{/each}
			</select>
			<button
				type="button"
				class="tp-cur__swap"
				aria-label={m['widget.currency.swap']()}
				data-testid="currency-swap"
				onclick={swap}
			>
				<TpIcon name="swap" size={14} />
			</button>
			<select
				class="tp-cur__code"
				aria-label={m['widget.currency.quote_label']()}
				data-testid="currency-quote"
				value={prefs.quote}
				onchange={(event) => setPair({ quote: event.currentTarget.value })}
			>
				{#each codes as code (code)}<option value={code}>{code}</option>{/each}
			</select>
		</div>

		<output class="tp-cur__hero tp-num" data-testid="currency-hero">{heroText}</output>

		<p class="tp-cur__rate">
			<span class="tp-num" data-testid="currency-rate">{rateLine}</span>
			{#if ageLine !== ''}
				<span class="tp-cur__age">{m['widget.currency.as_of']({ age: ageLine })}</span>
			{/if}
		</p>

		<!--
			doc 16 §5: a visible link wherever rates are shown, which is a link and
			not a text node. The label is upstream's own required wording and
			deliberately not translated.
		-->
		<a
			class="tp-cur__credit"
			href="https://www.exchangerate-api.com"
			target="_blank"
			rel="noopener noreferrer"
			data-testid="currency-credit">{attribution}</a
		>
	{/if}
</div>

<style>
	.tp-cur {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.25rem;
		justify-content: center;
		overflow: hidden;
	}

	.tp-cur[data-flat='true'] {
		justify-content: center;
	}

	.tp-cur__pair {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex: none;
	}

	.tp-cur__amount {
		width: 5.5rem;
		min-width: 0;
		flex: 1 1 auto;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		padding: 0.125rem 0.375rem;
	}

	.tp-cur__code {
		flex: none;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		padding: 0.125rem 0.25rem;
	}

	.tp-cur__swap {
		display: flex;
		flex: none;
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		line-height: 1;
		padding: 0.25rem;
	}

	.tp-cur__swap:hover {
		color: var(--color-beacon);
	}

	/* doc 12 §3: a number the reader watches change is mono + tnum. */
	.tp-cur__hero {
		font-size: var(--text-3xl);
		line-height: 1.1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-cur__flat {
		font-size: var(--text-lg);
		line-height: 1.1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-cur__rate {
		display: flex;
		gap: 0.375rem;
		margin: 0;
		overflow: hidden;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		white-space: nowrap;
	}

	.tp-cur__age {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tp-cur__credit {
		flex: none;
		overflow: hidden;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-cur__note {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-xs);
	}

	.tp-cur__note p {
		margin: 0;
	}

	.tp-cur__retry {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		padding: 0.125rem 0.5rem;
	}

	.tp-cur__skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.tp-cur__skeleton span {
		height: 0.75rem;
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
	}

	.tp-cur__skeleton span:first-child {
		width: 60%;
		height: 1.5rem;
	}
</style>
