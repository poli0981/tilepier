<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpMaybeNumber } from '$lib/api-types';
	import TpChart from '$lib/charts/TpChart.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpDetailProps } from '$lib/core/types';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import { fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpWeatherIcon from '$lib/ui/icons/TpWeatherIcon.svelte';
	import { wmoGlyph, type TpWmoGlyph } from '$lib/ui/icons/wmo';
	import { hourlyOption } from './chart';
	import {
		CHART_HOURS,
		currentHourIndex,
		hourlyPoints,
		isGap,
		readSettings,
		weatherSource,
		type TpWeatherReading
	} from './service';

	/**
	 * doc 08 §1's detail panel, and the first consumer of the ECharts bridge.
	 *
	 * **Three of the things that section lists are not here**, all of them depth
	 * cuts taken when Week 4 measured at four times its budget (doc 23's slip
	 * policy, and doc 08 §1 carries each one):
	 *
	 *  - the AQI gauge and the astronomy card;
	 *  - the cloud band on the 24 h chart, which needs `cloud_cover` added to
	 *    `/api/weather` — a `routes/api` change that should ride with the
	 *    air-quality timezone bug rather than land on its own.
	 *
	 * What ships is the pair that proves the tier-2 pattern M4 asks for: a real
	 * ECharts view, themed from tokens, over `swr()`'s cache — plus the 7-day
	 * strip and the readings doc 08 §1 lists beside it.
	 */
	interface Props extends TpDetailProps {
		/** Test seam, as on the tile: a throwaway Dexie rather than the reader's. */
		db?: TpDb | undefined;
	}

	let { settings: tileSettings, db = undefined }: Props = $props();

	const prefs = $derived(readSettings(tileSettings));

	let handle = $state.raw<TpSwrHandle<TpWeatherReading> | null>(null);

	$effect(() => {
		const place = prefs.place;
		if (place === null) return;

		// `untrack` for the reason doc 06 §5 rule 7 gives: `swr()` reads its
		// dedupe map and then writes to it, and that map is a `SvelteMap`.
		const source = untrack(() => weatherSource(place.lat, place.lon, db));
		handle = source;
		return () => {
			// The tile behind this panel holds the same key, so releasing here
			// only drops this subscriber — the entry survives on its refcount.
			source.release();
			handle = null;
		};
	});

	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(id);
	});

	const reading = $derived(handle?.data);
	const payload = $derived(reading?.payload);
	const status = $derived(handle?.status ?? 'loading');
	const hourIndex = $derived(payload === undefined ? -1 : currentHourIndex(payload, now));
	const hour = $derived(hourIndex === -1 ? undefined : payload?.hourly[hourIndex]);

	const points = $derived(
		payload === undefined || hourIndex === -1 ? [] : hourlyPoints(payload, hourIndex, CHART_HOURS)
	);
	const option = $derived(hourlyOption(points));

	/**
	 * doc 13 §8: every chart is paired with a summary line, so the reading is
	 * available to somebody who cannot see the canvas — and, at this size, to
	 * somebody who can but would rather not squint at an axis.
	 */
	const chartSummary = $derived.by(() => {
		const temps = points.map((p) => p.tempC).filter((t): t is number => t !== null);
		if (temps.length === 0) return m['widget.weather.no_readings']();
		return m['widget.weather.chart_summary']({
			hours: String(points.length),
			min: fmtDeg(Math.min(...temps)),
			max: fmtDeg(Math.max(...temps)),
			rain: String(Math.round(Math.max(0, ...points.map((p) => p.precipProb ?? 0))))
		});
	});

	const week = $derived(payload?.daily ?? []);
	const weekRange = $derived.by(() => {
		const highs = week.map((d) => d.maxC).filter((v): v is number => !isGap(v));
		const lows = week.map((d) => d.minC).filter((v): v is number => !isGap(v));
		if (highs.length === 0 || lows.length === 0) return { min: 0, max: 1 };
		return { min: Math.min(...lows), max: Math.max(...highs) };
	});

	function fmtDeg(value: TpMaybeNumber | undefined): string {
		return isGap(value) ? '—' : `${String(Math.round(value as number))}°`;
	}

	function fmtNum(value: TpMaybeNumber | undefined, unit: string): string {
		return isGap(value) ? '—' : `${String(Math.round(value as number))}${unit}`;
	}

	/** Where a day's hi/lo bar sits inside the week's whole range, 0…1. */
	function barBounds(min: TpMaybeNumber, max: TpMaybeNumber): { left: number; width: number } {
		if (isGap(min) || isGap(max)) return { left: 0, width: 0 };
		const span = weekRange.max - weekRange.min || 1;
		const left = ((min as number) - weekRange.min) / span;
		const width = ((max as number) - (min as number)) / span;
		return { left, width: Math.max(width, 0.02) };
	}

	function dayLabel(isoDate: string): string {
		const at = new Date(`${isoDate}T12:00:00`);
		return Number.isNaN(at.getTime())
			? isoDate
			: new Intl.DateTimeFormat(settings.locale, { weekday: 'short' }).format(at);
	}

	function glyphOf(code: TpMaybeNumber): TpWmoGlyph {
		return wmoGlyph(code);
	}

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
</script>

<div class="tp-wxd" data-testid="weather-detail" data-status={status}>
	{#if prefs.place === null}
		<p class="tp-wxd__note" data-testid="weather-detail-empty">
			{m['widget.weather.empty_detail']()}
		</p>
	{:else if reading === undefined}
		{#if status === 'offline'}
			<p class="tp-wxd__note" data-testid="weather-detail-offline">
				{m['widget.weather.offline']()}
			</p>
		{:else if status === 'error' || status === 'stale-error' || status === 'rate-limited'}
			<p class="tp-wxd__note" role="alert" data-testid="weather-detail-error">
				{m['widget.weather.error']()}
			</p>
		{:else}
			<p class="tp-wxd__note">{m['widget.weather.loading']()}</p>
		{/if}
	{:else}
		<header class="tp-wxd__head">
			<div>
				<h2>{prefs.place.name === '' ? m['widget.weather.my_location']() : prefs.place.name}</h2>
				{#if handle?.cachedAt !== undefined}
					<p class="tp-wxd__age">
						{m['widget.weather.as_of']({
							age: fmtRelative(handle.cachedAt, settings.locale, now)
						})}
					</p>
				{/if}
			</div>
			{#if hour !== undefined}
				<div class="tp-wxd__now">
					<TpWeatherIcon
						glyph={glyphOf(hour.code)}
						label={conditionName(glyphOf(hour.code))}
						size={28}
					/>
					<output class="tp-wxd__temp tp-num">{fmtDeg(hour.tempC)}</output>
				</div>
			{/if}
		</header>

		<TpChart
			{option}
			summary={chartSummary}
			loadingLabel={m['widget.weather.chart_loading']()}
			failedLabel={m['widget.weather.chart_failed']()}
			height={240}
		/>

		{#if hour !== undefined}
			<dl class="tp-wxd__readings">
				<div>
					<dt>{m['widget.weather.wind']()}</dt>
					<dd class="tp-num">{fmtNum(hour.windKph, ' km/h')}</dd>
				</div>
				<div>
					<dt>{m['widget.weather.humidity']()}</dt>
					<dd class="tp-num">{fmtNum(hour.humidity, '%')}</dd>
				</div>
				<div>
					<dt>{m['widget.weather.uv']()}</dt>
					<dd class="tp-num">{fmtNum(hour.uv, '')}</dd>
				</div>
				<div>
					<dt>{m['widget.weather.pressure']()}</dt>
					<dd class="tp-num">{fmtNum(hour.pressureHpa, ' hPa')}</dd>
				</div>
			</dl>
		{/if}

		{#if week.length > 0}
			<section class="tp-wxd__week" aria-label={m['widget.weather.week']()}>
				{#each week as day (day.date)}
					{@const bounds = barBounds(day.minC, day.maxC)}
					<div class="tp-wxd__day" data-testid="weather-day">
						<span class="tp-wxd__dayname">{dayLabel(day.date)}</span>
						<TpWeatherIcon
							glyph={glyphOf(day.code)}
							label={conditionName(glyphOf(day.code))}
							size={16}
						/>
						<span class="tp-wxd__lo tp-num">{fmtDeg(day.minC)}</span>
						<span class="tp-wxd__track">
							<span
								class="tp-wxd__bar"
								style:left="{String(bounds.left * 100)}%"
								style:width="{String(bounds.width * 100)}%"
							></span>
						</span>
						<span class="tp-wxd__hi tp-num">{fmtDeg(day.maxC)}</span>
					</div>
				{/each}
			</section>
		{/if}

		<!-- doc 10 §8 / doc 16 §5: the attribution rides inside the payload so the
		     UI cannot forget it. Rendered as a text node (CLAUDE.md rule 7). -->
		<p class="tp-wxd__credit" data-testid="weather-attribution">{payload?.attribution}</p>
	{/if}
</div>

<style>
	.tp-wxd {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.tp-wxd__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.tp-wxd__head h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.tp-wxd__age {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-wxd__now {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.tp-wxd__temp {
		font-size: var(--text-2xl);
		line-height: 1.1;
	}

	.tp-wxd__readings {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6rem, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.tp-wxd__readings dt {
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-wxd__readings dd {
		margin: 0;
		font-size: var(--text-base);
	}

	.tp-wxd__week {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.tp-wxd__day {
		display: grid;
		grid-template-columns: 2.5rem 1rem 2.5rem 1fr 2.5rem;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-2xs);
	}

	.tp-wxd__dayname {
		color: var(--color-fg-mute);
	}

	.tp-wxd__lo {
		color: var(--color-fg-dim);
		text-align: right;
	}

	.tp-wxd__hi {
		text-align: right;
	}

	.tp-wxd__track {
		position: relative;
		height: 4px;
		border-radius: 2px;
		background: var(--color-ink-850);
	}

	.tp-wxd__bar {
		position: absolute;
		top: 0;
		height: 100%;
		border-radius: 2px;
		background: var(--color-beacon);
	}

	.tp-wxd__note {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-wxd__credit {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
