<script lang="ts">
	import { logEntry } from '$lib/core/log-buffer';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtDate, fmtTime } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		MAX_ZONES,
		PLANNER_SPAN_HOURS,
		PLANNER_STEP_MINUTES,
		canonicalZone,
		homeZone,
		normaliseZones,
		offsetDeltaMinutes,
		offsetLabel,
		searchZones,
		solarPhase,
		startOfLocalDay,
		zoneCityLabel,
		zoneRegionLabel
	} from './service';

	/**
	 * The world-clock board (doc 07 §1): the viewer's zone as hero, a grid of
	 * followed zones tinted for day or night, the time-difference ruler, and the
	 * meeting-planner strip.
	 *
	 * SVG and CSS only — no chart library, per doc 07 §1. The tint is a token
	 * gradient and the planner is a range input, which is a draggable marker
	 * that also happens to work from the keyboard.
	 */
	let { settings: tileSettings, onUpdateSettings }: TpDetailProps = $props();

	const home = homeZone();

	let now = $state(Date.now());
	/** Minutes from the start of the viewer's local day. `null` means "follow
	 *  the clock" — the planner is parked and every row reads live. */
	let plannerMinutes = $state<number | null>(null);
	let query = $state('');
	let picking = $state(false);

	$effect(() => {
		// Keeps the board on the wall clock while it is open. Every read computes
		// from Date.now() rather than counting ticks, so a throttled tab is
		// correct the moment it returns (doc 04 §3).
		const id = setInterval(() => (now = Date.now()), 1000);
		const onVisible = (): void => {
			if (document.visibilityState === 'visible') now = Date.now();
		};
		document.addEventListener('visibilitychange', onVisible);

		return () => {
			clearInterval(id);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const stored = $derived(normaliseZones(tileSettings['zones']));
	const zones = $derived(stored.zones);

	$effect(() => {
		// doc 07 §1: an unknown stored zone is dropped and warned about, once.
		// Writing the pruned list straight back is what stops the warning
		// repeating on every open — the same move doc 05 §5 makes for a layout
		// naming a widget this build does not have.
		if (stored.dropped.length === 0) return;
		for (const zone of stored.dropped) {
			logEntry('warn', `${m['widget.clock.dropped_zone']()}: ${zone}`, { src: 'widget' });
		}
		onUpdateSettings?.({ zones: stored.zones });
	});

	const hour12 = $derived(
		typeof tileSettings['clock24h'] === 'boolean' ? !tileSettings['clock24h'] : !settings.clock24h
	);
	const showSeconds = $derived(tileSettings['showSeconds'] === true);

	/** The instant every row reads — live, or wherever the planner marker sits. */
	const at = $derived(
		plannerMinutes === null ? now : startOfLocalDay(now, home) + plannerMinutes * 60_000
	);

	interface Row {
		zone: string;
		time: string;
		date: string;
		delta: string;
		phase: 'day' | 'twilight' | 'night';
	}

	function read(zone: string): Row {
		return {
			zone,
			time: fmtTime(at, settings.locale, { hour12, seconds: showSeconds, timeZone: zone }),
			date: fmtDate(at, settings.locale, { timeZone: zone }),
			delta: offsetLabel(offsetDeltaMinutes(at, zone, home)),
			phase: solarPhase(at, zone)
		};
	}

	const hero = $derived(read(home));
	const rows = $derived(zones.map(read));

	const matches = $derived(picking ? searchZones(query, 30) : []);
	const full = $derived(zones.length >= MAX_ZONES);

	function addZone(zone: string): void {
		const canonical = canonicalZone(zone);
		if (zones.includes(canonical) || full) return;
		onUpdateSettings?.({ zones: [...zones, canonical] });
		query = '';
		picking = false;
	}

	function removeZone(zone: string): void {
		onUpdateSettings?.({ zones: zones.filter((entry) => entry !== zone) });
	}

	function phaseLabel(phase: Row['phase']): string {
		if (phase === 'day') return m['widget.clock.phase.day']();
		if (phase === 'twilight') return m['widget.clock.phase.twilight']();
		return m['widget.clock.phase.night']();
	}
</script>

<div class="tp-clockd">
	<section class="tp-clockd__hero" data-phase={hero.phase}>
		<p class="tp-clockd__label">{m['widget.clock.detail.home']()}</p>
		<p class="tp-clockd__city">{zoneCityLabel(home)}</p>
		<time class="tp-clockd__time tp-num">{hero.time}</time>
		<p class="tp-clockd__meta">
			{hero.date} · {phaseLabel(hero.phase)}
		</p>
	</section>

	<section class="tp-clockd__planner">
		<div class="tp-clockd__row">
			<h3>{m['widget.clock.detail.planner']()}</h3>
			<button
				type="button"
				class="tp-clockd__now"
				data-testid="planner-now"
				aria-pressed={plannerMinutes === null}
				onclick={() => (plannerMinutes = null)}
			>
				{m['widget.clock.detail.now']()}
			</button>
		</div>
		<!--
			A range input rather than a bespoke drag handler: doc 07 §1 asks for a
			draggable marker, and this is one that arrows and Home/End also move,
			which no amount of pointer-event code would have given for free.
		-->
		<input
			class="tp-clockd__strip"
			type="range"
			min="0"
			max={PLANNER_SPAN_HOURS * 60}
			step={PLANNER_STEP_MINUTES}
			data-testid="planner-strip"
			aria-label={m['widget.clock.detail.planner']()}
			value={plannerMinutes ?? Math.round((now - startOfLocalDay(now, home)) / 60_000)}
			oninput={(event) => (plannerMinutes = Number(event.currentTarget.value))}
		/>
		<p class="tp-clockd__hint">{m['widget.clock.detail.planner_hint']()}</p>
	</section>

	<section class="tp-clockd__board">
		<div class="tp-clockd__row">
			<h3>{m['widget.clock.detail.zones']()}</h3>
			<button
				type="button"
				class="tp-clockd__add"
				disabled={full}
				data-testid="add-zone"
				onclick={() => (picking = !picking)}
			>
				<TpIcon name="plus" size={14} />
				{full ? m['widget.clock.detail.full']() : m['widget.clock.detail.add_zone']()}
			</button>
		</div>

		{#if picking}
			<label class="tp-clockd__search">
				<TpIcon name="search" size={16} />
				<input
					type="search"
					bind:value={query}
					placeholder={m['widget.clock.detail.search_zone']()}
					data-testid="zone-search"
				/>
			</label>
			<ul class="tp-clockd__results">
				{#each matches as zone (zone)}
					<li>
						<button type="button" onclick={() => addZone(zone)} data-testid="zone-option">
							<span>
								{zoneCityLabel(zone)}
								<span class="tp-clockd__zoneid">{zoneRegionLabel(zone)}</span>
							</span>
							<span class="tp-clockd__zoneid tp-num"
								>{offsetLabel(offsetDeltaMinutes(at, zone, home))}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if rows.length === 0}
			<!-- doc 06 §3's `empty`: guidance plus exactly one action. -->
			<div class="tp-clockd__empty" data-testid="zones-empty">
				<p>{m['widget.clock.detail.no_zones']()}</p>
				<button type="button" class="tp-clockd__add" onclick={() => (picking = true)}>
					{m['widget.clock.detail.no_zones_action']()}
				</button>
			</div>
		{:else}
			<ul class="tp-clockd__zones">
				{#each rows as row (row.zone)}
					<li data-phase={row.phase} data-testid="zone-row">
						<div class="tp-clockd__zonetext">
							<p class="tp-clockd__city">{zoneCityLabel(row.zone)}</p>
							<p class="tp-clockd__meta">{row.date} · {phaseLabel(row.phase)}</p>
						</div>
						<time class="tp-clockd__zonetime tp-num">{row.time}</time>
						<span class="tp-clockd__delta tp-num">{row.delta}</span>
						<button
							type="button"
							class="tp-clockd__remove"
							aria-label={m['widget.clock.detail.remove_zone']({ zone: zoneCityLabel(row.zone) })}
							onclick={() => removeZone(row.zone)}
						>
							<TpIcon name="close" size={14} />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="tp-clockd__prefs">
		<label>
			<input
				type="checkbox"
				checked={showSeconds}
				data-testid="clock-seconds"
				onchange={(event) => onUpdateSettings?.({ showSeconds: event.currentTarget.checked })}
			/>
			{m['widget.clock.settings.seconds']()}
		</label>
		<label>
			<input
				type="checkbox"
				checked={!hour12}
				data-testid="clock-24h"
				onchange={(event) => onUpdateSettings?.({ clock24h: event.currentTarget.checked })}
			/>
			{m['widget.clock.settings.hour24']()}
		</label>
	</section>

	<!-- The limitation is stated where it can be seen, not only in the source:
	     the tint is an equatorial terminator (service.ts). -->
	<p class="tp-clockd__note">{m['widget.clock.detail.tint_note']()}</p>
</div>

<style>
	.tp-clockd {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	h3 {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		font-weight: 500;
		text-transform: lowercase;
	}

	.tp-clockd__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}

	/* Day/night tint: a wash of the beacon for day, nothing for night, and the
	   warn lamp for the twilight band (doc 12 §2 tokens only). */
	.tp-clockd__hero,
	.tp-clockd__zones li {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-900);
	}

	[data-phase='day'] {
		background:
			linear-gradient(
				to right,
				color-mix(in oklch, var(--color-beacon) 10%, transparent),
				transparent 60%
			),
			var(--color-ink-900);
	}

	[data-phase='twilight'] {
		background:
			linear-gradient(
				to right,
				color-mix(in oklch, var(--color-warn) 12%, transparent),
				transparent 60%
			),
			var(--color-ink-900);
	}

	.tp-clockd__hero {
		padding: 1rem 1.25rem;
	}

	.tp-clockd__label {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-clockd__city {
		margin: 0.125rem 0 0;
		color: var(--color-fg);
		font-size: var(--text-base);
		font-weight: 500;
	}

	.tp-clockd__time {
		display: block;
		margin-top: 0.25rem;
		color: var(--color-fg);
		font-size: var(--text-hero);
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}

	.tp-clockd__meta {
		margin: 0.125rem 0 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-clockd__strip {
		width: 100%;
		accent-color: var(--color-beacon);
	}

	.tp-clockd__hint,
	.tp-clockd__note {
		margin: 0.375rem 0 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-clockd__zones {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-clockd__zones li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
	}

	.tp-clockd__zonetext {
		flex: 1 1 auto;
		min-width: 0;
	}

	.tp-clockd__zonetime {
		color: var(--color-fg);
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.tp-clockd__delta {
		min-width: 3.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		text-align: right;
	}

	.tp-clockd__now,
	.tp-clockd__add {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 40px;
		padding: 0 0.75rem;
	}

	.tp-clockd__now[aria-pressed='true'] {
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
	}

	.tp-clockd__add:disabled {
		color: var(--color-ink-500);
		cursor: default;
	}

	.tp-clockd__remove {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		min-width: 40px;
		min-height: 40px;
	}

	.tp-clockd__remove:hover {
		color: var(--color-danger);
	}

	.tp-clockd__search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		padding: 0 0.625rem;
		margin-bottom: 0.5rem;
		color: var(--color-fg-dim);
	}

	.tp-clockd__search input {
		flex: 1 1 auto;
		border: 0;
		background: none;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		min-height: 40px;
		outline: none;
	}

	.tp-clockd__results {
		display: flex;
		flex-direction: column;
		max-height: 14rem;
		overflow: auto;
		margin: 0 0 0.75rem;
		padding: 0;
		list-style: none;
	}

	.tp-clockd__results button {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		min-height: 40px;
		padding: 0 0.5rem;
		text-align: left;
	}

	.tp-clockd__results button:hover {
		background: var(--color-ink-900);
		color: var(--color-fg);
	}

	.tp-clockd__zoneid {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-clockd__empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-clockd__empty p {
		margin: 0;
	}

	.tp-clockd__prefs {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
		border-top: 1px solid var(--color-ink-700);
		padding-top: 1rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-clockd__prefs label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
</style>
