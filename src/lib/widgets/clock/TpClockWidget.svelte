<script lang="ts">
	import type { TpWidgetProps } from '$lib/core/types';
	import { settings } from '$lib/stores/settings.svelte';

	/**
	 * doc 07 §1 — tile half. The world-clock detail (extra zones, the
	 * meeting-planner strip) arrives in Week 2 with the rest of tier 1.
	 *
	 * Timing is deliberate: the display ticks on a 1 s interval, but every
	 * render computes from `Date.now()` rather than counting ticks, so a
	 * throttled background tab shows the correct time the moment it returns
	 * instead of however far behind it drifted (doc 04 §3, doc 07 §1).
	 *
	 * The lunar date line (doc 07 §1, vi only) needs `lib/lunar`, which is
	 * ported in Week 3; the footer makes room for it now.
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

	// Memoised per locale + format: constructing Intl formatters is the
	// expensive part, and this one runs every second.
	const timeFormat = $derived(
		new Intl.DateTimeFormat(settings.locale, {
			hour: '2-digit',
			minute: '2-digit',
			...(showSeconds ? { second: '2-digit' } : {}),
			hour12
		})
	);

	const dateFormat = $derived(
		new Intl.DateTimeFormat(settings.locale, { weekday: 'short', day: '2-digit', month: '2-digit' })
	);

	const time = $derived(timeFormat.format(now));
	const date = $derived(dateFormat.format(now));
</script>

<div class="tp-clock" data-tier={size.tier}>
	<time class="tp-clock__time tp-num" datetime={new Date(now).toISOString()}>{time}</time>
	{#if size.tier !== 'S'}
		<p class="tp-clock__date">{date}</p>
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
</style>
