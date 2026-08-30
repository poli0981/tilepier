<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpMaybeNumber } from '$lib/api-types';
	import { useRefresh } from '$lib/core/refresh.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import { fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpWeatherIcon from '$lib/ui/icons/TpWeatherIcon.svelte';
	import { wmoGlyph, type TpWmoGlyph } from '$lib/ui/icons/wmo';
	import type { TpTileSize } from '$lib/core/types';
	import {
		currentHourIndex,
		isGap,
		sparklinePoints,
		weatherKey,
		weatherSource,
		type TpWeatherReading
	} from './service';
	import { SPARKLINE_HOURS, type TpWeatherPlace } from './types';

	/**
	 * One place's readout — the half of the weather tile that has data.
	 *
	 * It exists as its own component because of a trap in `useRefresh`. That
	 * helper reads its `id` as a plain parameter inside a dependency-free
	 * `$effect` (`core/refresh.svelte.ts`, deliberately — see its comment), so
	 * the registration is snapshotted at mount; and `TpGrid.updateTile` pushes a
	 * changed tile record into a *mounted* host without remounting it
	 * (doc 06 §5 rule 11). Put the subscription in the outer component and
	 * changing the place would leave the scheduler registered under the old data
	 * key and register nothing for the new one — the tile would render the first
	 * fetch correctly and then quietly never refresh again.
	 *
	 * `{#key dataKey}` around this component is the fix, and it has to wrap both
	 * halves together: one remount rebuilds the `swr` subscription and the
	 * scheduler entry in the same motion.
	 *
	 * **States (doc 06 §3).** `weather` is doc 17 §3's cached-data class, so all
	 * seven are required. Six map from `TpSwrStatus`; `empty` is a judgement
	 * about the payload's contents that `swr` cannot make and is handled partly
	 * here (a payload with no usable hours) and partly by the parent (no place
	 * chosen at all). `permission-needed` belongs to the parent too — it is a
	 * browser state, reachable only once something can ask for a position.
	 *
	 * Tier S is unreachable: `sizes.min` is 2×2 and tier S is `w<=2 && h<=1`.
	 * Named here rather than skipped, per doc 06 §3's single-widget N/A rule.
	 */
	interface Props {
		place: TpWeatherPlace;
		size: TpTileSize;
		/** Test seam: a throwaway Dexie, the way `swr.svelte.test.ts` drives one. */
		db?: TpDb | undefined;
	}

	let { place, size, db = undefined }: Props = $props();

	/**
	 * The value at mount, deliberately, and `untrack` is how that is said out
	 * loud rather than left to a comment: reading a prop at component-body
	 * level captures its initial value, and Svelte warns about it
	 * (`state_referenced_locally`) because that is usually a mistake.
	 *
	 * Here it is the design. The parent keys this component on exactly this
	 * string, so a place that moves to another cache cell arrives as a fresh
	 * mount rather than as a changed prop — and `useRefresh` below snapshots
	 * its id anyway, so a reactive key would be a promise this could not keep.
	 */
	const dataKey = untrack(() => weatherKey(place.lat, place.lon));

	let handle = $state.raw<TpSwrHandle<TpWeatherReading> | null>(null);

	$effect(() => {
		// `untrack`, for the same reason doc 06 §5 rule 7 untracks `TpGrid`'s setup
		// effect. `swr()` reads its dedupe map and then writes to it, and that map
		// is a `SvelteMap` — tracked, the read subscribes, the write invalidates,
		// and the effect re-runs itself until Svelte gives up with
		// `effect_update_depth_exceeded`. There is nothing to depend on anyway: the
		// `{#key dataKey}` in the parent is what makes a place change rebuild this.
		const source = untrack(() => weatherSource(place.lat, place.lon, db));
		handle = source;
		return () => {
			// `swr` refcounts by key, so this is what lets two tiles on one place
			// share an entry without either of them taking it down early.
			source.release();
			handle = null;
		};
	});

	// doc 04 §3: the scheduler id is the *data key*, not the instanceId, so two
	// tiles pinned to the same place run one task between them. `revalidate()`
	// rejects on failure by design — that is how the scheduler takes ownership
	// of the backoff curve rather than the widget inventing its own.
	//
	// `runOnRegister: false` because the first load is not this task's job:
	// subscribing already hydrates from Dexie and revalidates if that is stale
	// (doc 04 §2.1). Leaving it on would also make `useRefresh`'s effect read
	// `handle` synchronously at registration — a dependency on state another
	// effect writes, which is a second route into the same re-run loop.
	useRefresh(
		dataKey,
		{ kind: 'interval', everyMs: 600_000 },
		async () => {
			await handle?.revalidate('scheduler');
		},
		{ label: `weather:${dataKey}`, runOnRegister: false }
	);

	const status = $derived(handle?.status ?? 'loading');
	const reading = $derived(handle?.data);
	const payload = $derived(reading?.payload);

	/**
	 * The Worker's own staleness, which `swr` cannot see. A KV entry served past
	 * its TTL because upstream failed comes back with a fresh `cachedAt` and a
	 * `meta.stale` of true (doc 11 §4); without this the tile would call an
	 * hour-old temperature current.
	 */
	const servedStale = $derived(reading?.meta.stale === true);

	let now = $state(Date.now());
	$effect(() => {
		// Only to keep the age line and the "now" hour honest on a deck left
		// open. The data itself is the scheduler's business.
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	const hourIndex = $derived(payload === undefined ? -1 : currentHourIndex(payload, now));
	const hour = $derived(hourIndex === -1 ? undefined : payload?.hourly[hourIndex]);
	const today = $derived(payload?.daily[0]);

	/** doc 06 §3's `empty`: a payload that arrived and has nothing to render. */
	const noReadings = $derived(payload !== undefined && hour === undefined);

	const glyph = $derived<TpWmoGlyph>(wmoGlyph(hour?.code));
	const conditionLabel = $derived(conditionName(glyph));

	// doc 08 §1 gates the sparkline on h≥3 — NOT on the density tier. Tier is L
	// only at `w>=4 || h>=4`, so a 3×3 tile is tier M and would silently lose it.
	const spark = $derived(
		payload === undefined || hourIndex === -1 || size.h < 3
			? null
			: sparklinePoints(payload, hourIndex, SPARKLINE_HOURS)
	);

	const ageLine = $derived(
		handle?.cachedAt === undefined ? '' : fmtRelative(handle.cachedAt, settings.locale, now)
	);

	function conditionName(value: TpWmoGlyph): string {
		switch (value) {
			case 'clear':
				return m['widget.weather.wmo_clear']();
			case 'partly-cloudy':
				return m['widget.weather.wmo_partly_cloudy']();
			case 'overcast':
				return m['widget.weather.wmo_overcast']();
			case 'fog':
				return m['widget.weather.wmo_fog']();
			case 'rain':
				return m['widget.weather.wmo_rain']();
			case 'snow':
				return m['widget.weather.wmo_snow']();
			case 'thunder':
				return m['widget.weather.wmo_thunder']();
			default:
				return m['widget.weather.wmo_unknown']();
		}
	}

	/** Every numeric read goes through here. A gap renders an em dash, never
	 *  `NaN°` and never a zero — doc 10 §2 is explicit that 0 °C is a
	 *  temperature and a gap is not. */
	function degrees(value: TpMaybeNumber | undefined): string {
		return isGap(value) ? '—' : `${String(Math.round(value as number))}°`;
	}

	function retry(): void {
		void handle?.revalidate('retry');
	}
</script>

<div class="tp-wx" data-testid="weather-readout" data-status={status}>
	{#if reading === undefined}
		{#if status === 'offline'}
			<!-- doc 17 §3: cached-data offline with nothing cached is the offline
			     card, not a badge over an empty box. -->
			<p class="tp-wx__note" data-testid="weather-offline">
				{m['widget.weather.offline']()}
			</p>
		{:else if status === 'error' || status === 'stale-error' || status === 'rate-limited'}
			<!-- doc 13 §7: inline, one sentence, a retry. The tile never blanks. -->
			<div class="tp-wx__note" role="alert" data-testid="weather-error">
				<p>
					{status === 'rate-limited'
						? m['widget.weather.rate_limited']()
						: m['widget.weather.error']()}
				</p>
				<button type="button" class="tp-wx__retry" onclick={retry}>
					{m['common.retry']()}
				</button>
			</div>
		{:else}
			<!-- doc 13 §7: a skeleton in ink-850, never a spinner inside a tile. -->
			<div class="tp-wx__skeleton" aria-label={m['widget.weather.loading']()}>
				<span></span><span></span>
			</div>
		{/if}
	{:else if noReadings}
		<p class="tp-wx__note" data-testid="weather-no-readings">
			{m['widget.weather.no_readings']()}
		</p>
	{:else}
		<div class="tp-wx__head">
			<span class="tp-wx__place" data-testid="weather-place">{place.name}</span>
			{#if status === 'offline'}
				<span class="tp-wx__badge tp-wx__badge--offline" data-testid="weather-badge-offline">
					{m['widget.weather.offline_short']()}
				</span>
			{:else if status === 'stale' || status === 'stale-error' || servedStale}
				<!-- doc 13 §7's stale badge. In the tile body rather than the host
				     header: the header is `TpWidgetHost`'s, hosts are mounted
				     imperatively and cannot take a reactive prop, and the shared
				     channel that would fix that is a `core/` change Week 4 cut.
				     Recorded as a deviation in doc 13 §3. -->
				<span
					class="tp-wx__badge tp-wx__badge--stale"
					title={m['widget.weather.stale_hint']()}
					data-testid="weather-badge-stale"
				>
					{m['widget.weather.stale']({ age: ageLine })}
				</span>
				{#if status === 'stale-error'}
					<button
						type="button"
						class="tp-wx__retry tp-wx__retry--icon"
						aria-label={m['common.retry']()}
						data-testid="weather-retry"
						onclick={retry}
					>
						<TpIcon name="expand" size={12} />
					</button>
				{/if}
			{/if}
		</div>

		<div class="tp-wx__now">
			<TpWeatherIcon {glyph} label={conditionLabel} size={size.h >= 3 ? 32 : 26} />
			<output class="tp-wx__temp tp-num" data-testid="weather-temp">
				{degrees(hour?.tempC)}
			</output>
			<div class="tp-wx__side">
				{#if today !== undefined}
					<span class="tp-wx__hilo tp-num" data-testid="weather-hilo">
						{m['widget.weather.hi_lo']({ hi: degrees(today.maxC), lo: degrees(today.minC) })}
					</span>
				{/if}
				{#if !isGap(hour?.precipProb)}
					<span class="tp-wx__precip tp-num" data-testid="weather-precip">
						{m['widget.weather.precip_chance']({
							percent: String(Math.round(hour?.precipProb as number))
						})}
					</span>
				{/if}
			</div>
		</div>

		{#if spark !== null}
			<!-- Inline SVG, not ECharts: doc 08 §1 keeps the chart in the detail,
			     and a tile chunk has 40 KB (doc 20 §6). `preserveAspectRatio=none`
			     lets one unit box stretch to whatever the tile is. -->
			<figure class="tp-wx__spark">
				<svg viewBox="0 0 100 30" preserveAspectRatio="none" role="presentation" aria-hidden="true">
					{#each spark.segments as segment, i (i)}
						{#if segment.length > 1}
							<polyline
								points={segment.map((p) => `${String(p.x * 100)},${String(p.y * 30)}`).join(' ')}
							/>
						{:else if segment[0] !== undefined}
							<circle cx={segment[0].x * 100} cy={segment[0].y * 30} r="1.2" />
						{/if}
					{/each}
				</svg>
				<figcaption data-testid="weather-spark-summary">
					{m['widget.weather.sparkline_summary']({
						hours: String(spark.hours),
						min: degrees(spark.minC),
						max: degrees(spark.maxC)
					})}
				</figcaption>
			</figure>
		{/if}
	{/if}
</div>

<style>
	.tp-wx {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.25rem;
		overflow: hidden;
	}

	.tp-wx__head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 1rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-wx__place {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-wx__badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex: none;
		border-radius: var(--radius-ctl);
		padding: 0 0.25rem;
	}

	/* doc 13 §7: an amber lamp, and never colour alone — the badge carries its
	   own age text, so the dot is redundant reinforcement rather than the only
	   channel (doc 12 §4.2). */
	.tp-wx__badge--stale {
		color: var(--color-warn);
		background: color-mix(in oklch, var(--color-warn) 12%, transparent);
	}

	.tp-wx__badge--offline {
		color: var(--color-fg-dim);
		background: var(--color-ink-850);
	}

	.tp-wx__now {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 0;
	}

	.tp-wx__temp {
		font-size: var(--text-3xl);
		line-height: 1.1;
		color: var(--color-fg);
	}

	.tp-wx__side {
		display: flex;
		min-width: 0;
		flex-direction: column;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-wx__spark {
		flex: 1 1 auto;
		min-height: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}

	.tp-wx__spark svg {
		flex: 1 1 auto;
		width: 100%;
		min-height: 0;
	}

	.tp-wx__spark polyline,
	.tp-wx__spark circle {
		fill: none;
		stroke: var(--color-beacon);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}

	.tp-wx__spark circle {
		fill: var(--color-beacon);
		stroke: none;
	}

	/* doc 13 §8: every chart gets an accessible summary line. Visible here
	   rather than screen-reader-only, because at this size it is also the axis. */
	.tp-wx__spark figcaption {
		flex: none;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-wx__note {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.375rem;
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-wx__note p {
		margin: 0;
	}

	.tp-wx__retry {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		padding: 0.125rem 0.5rem;
	}

	.tp-wx__retry--icon {
		flex: none;
		padding: 0.125rem;
		border-color: transparent;
	}

	.tp-wx__skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.tp-wx__skeleton span {
		height: 0.75rem;
		border-radius: 3px;
		background: var(--color-ink-850);
	}

	.tp-wx__skeleton span:nth-child(1) {
		width: 45%;
	}

	.tp-wx__skeleton span:nth-child(2) {
		width: 70%;
		height: 1.5rem;
	}

	/* doc 12 §5 / §7: the tide-gauge shimmer, held still under reduced motion. */
	@media (prefers-reduced-motion: no-preference) {
		.tp-wx__skeleton span {
			animation: tp-wx-tide 1.6s ease-in-out infinite;
		}

		.tp-wx__skeleton span:nth-child(2) {
			animation-delay: 0.12s;
		}
	}

	@keyframes tp-wx-tide {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}
</style>
