<script lang="ts">
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtDate, fmtTime } from '$lib/i18n/fmt';
	import { settings } from '$lib/stores/settings.svelte';
	import {
		TILE_ZONE_ROWS,
		normaliseZones,
		offsetLabel,
		offsetDeltaMinutes,
		homeZone,
		zoneCityLabel
	} from './service';

	/**
	 * doc 07 §1 — the tile. The world-clock board is the detail
	 * (`TpClockDetail.svelte`); this shows the local time and, at h ≥ 2, up to
	 * three of the zones the board is following.
	 *
	 * Timing is deliberate: the display ticks on a 1 s interval, but every render
	 * computes from `Date.now()` rather than counting ticks, so a throttled
	 * background tab shows the correct time the moment it returns instead of
	 * however far behind it drifted (doc 04 §3, doc 07 §1).
	 *
	 * **States (doc 06 §3, as amended for the doc 17 §3 pure-client class).**
	 * `stale`, `stale-error` and `offline` do not apply — there is no network.
	 * Two more are unreachable by the nature of this widget rather than by its
	 * class, and are called out here rather than left as a silent gap: there is
	 * no `loading`, because the time needs no fetch and a skeleton would flash
	 * for one frame over data already in hand; and no `empty`, because a clock
	 * always has something to say. `error` is the host's `svelte:boundary`
	 * (doc 17 §6). That leaves `ready`, which is the whole tile.
	 *
	 * The lunar date line (doc 07 §1, vi only) needs `lib/lunar`, which is ported
	 * in Week 3; the footer makes room for it now.
	 */
	let { settings: tileSettings, size }: TpWidgetProps = $props();

	/** Per-instance override; falls back to the app-wide preference (doc 07 §1). */
	const hour12 = $derived(
		typeof tileSettings['clock24h'] === 'boolean' ? !tileSettings['clock24h'] : !settings.clock24h
	);
	const showSeconds = $derived(tileSettings['showSeconds'] === true);

	let now = $state(Date.now());

	$effect(() => {
		// Synchronises the displayed time with the wall clock while mounted.
		const id = setInterval(() => (now = Date.now()), 1000);
		// A hidden tab throttles timers; recompute on return rather than trusting
		// however many ticks did or did not fire.
		const onVisible = (): void => {
			if (document.visibilityState === 'visible') now = Date.now();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(id);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const home = homeZone();

	const time = $derived(fmtTime(now, settings.locale, { hour12, seconds: showSeconds }));
	const date = $derived(fmtDate(now, settings.locale));

	/**
	 * doc 07 §1: 0–3 compact rows, and only once the tile is at least two rows
	 * tall. The detail follows up to twelve; the tile shows the head of that list
	 * rather than a scroller, because a tile that scrolls is a tile you have to
	 * interact with to read.
	 */
	const rows = $derived(
		size.h >= 2
			? normaliseZones(tileSettings['zones'])
					.zones.slice(0, TILE_ZONE_ROWS)
					.map((zone) => ({
						zone,
						city: zoneCityLabel(zone),
						time: fmtTime(now, settings.locale, { hour12, timeZone: zone }),
						delta: offsetLabel(offsetDeltaMinutes(now, zone, home))
					}))
			: []
	);
</script>

<div class="tp-clock" data-tier={size.tier}>
	<time class="tp-clock__time tp-num" datetime={new Date(now).toISOString()}>{time}</time>
	{#if size.tier !== 'S'}
		<p class="tp-clock__date">{date}</p>
	{/if}

	{#if rows.length > 0}
		<ul class="tp-clock__zones">
			{#each rows as row (row.zone)}
				<li>
					<span class="tp-clock__city">{row.city}</span>
					<span class="tp-clock__zonetime tp-num">{row.time}</span>
					<span class="tp-clock__delta tp-num">{row.delta}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.tp-clock {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.25rem;
		overflow: hidden;
	}

	/* doc 12 §3: numbers the user watches are mono + tnum, and the hero size
	   only earns its space once there is space. */
	.tp-clock__time {
		font-size: var(--text-xl);
		font-weight: 600;
		color: var(--color-fg);
		letter-spacing: -0.02em;
	}

	.tp-clock[data-tier='S'] .tp-clock__time {
		font-size: var(--text-lg);
	}

	.tp-clock[data-tier='L'] .tp-clock__time {
		font-size: var(--text-hero);
	}

	.tp-clock__date {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-clock__zones {
		display: flex;
		width: 100%;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0.375rem 0 0;
		padding: 0;
		list-style: none;
		min-height: 0;
		overflow: hidden;
	}

	.tp-clock__zones li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-clock__city {
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-clock__zonetime {
		color: var(--color-fg);
	}

	.tp-clock__delta {
		min-width: 2.75rem;
		color: var(--color-fg-dim);
		text-align: right;
	}
</style>
