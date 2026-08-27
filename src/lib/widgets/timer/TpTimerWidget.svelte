<script lang="ts">
	import { untrack } from 'svelte';
	import { logEntry } from '$lib/core/log-buffer';
	import type { TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import { notifyDone, notifyPermission, playChime } from './alert';
	import {
		complete,
		formatRemaining,
		logFocusSession,
		pause,
		phaseDurationMs,
		progress,
		readSettings,
		remainingMs,
		reset,
		start,
		statusOf,
		streak
	} from './service';
	import type { TpTimerPhase, TpTimerSettings } from './types';

	/**
	 * doc 07 §2 — the tile. Ring progress and mm:ss for a countdown; the session
	 * ring, a phase chip and today's streak dots for a pomodoro.
	 *
	 * **This is where a finished timer is noticed**, and deliberately the only
	 * place: the detail renders from the same settings and shows the same
	 * states, but if both completed a phase the session would be logged twice
	 * and the phase advanced twice. The tile is the component that is mounted
	 * whenever the deck is, including underneath an open detail overlay.
	 *
	 * States (doc 06 §3, pure-client class): `ready` in all four of its
	 * statuses, `permission-needed` when notifications were asked for and the
	 * browser refused, and `error` through the host's boundary. `loading` and
	 * `empty` are unreachable — a timer has no fetch and always has a duration.
	 */
	let { settings: tileSettings, size, onUpdateSettings }: TpWidgetProps = $props();

	/**
	 * How late a completion may be noticed and still be worth making a noise
	 * about. Background tabs throttle timers to roughly one tick a minute, so a
	 * live-but-hidden tab lands inside this; a laptop that was shut does not,
	 * and gets doc 07 §2's "finished while away" state in silence instead. A
	 * chime ten minutes after the fact is noise, not information.
	 */
	const FRESH_MS = 60_000;

	const RADIUS = 44;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	let now = $state(Date.now());

	$effect(() => {
		// Synchronises the readout with the wall clock. The *correctness* of the
		// timer does not depend on this interval — `endsAt` is absolute — only
		// how often the digits change (doc 07 §2).
		const id = setInterval(() => (now = Date.now()), 500);
		const onVisible = (): void => {
			if (document.visibilityState === 'visible') now = Date.now();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(id);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const timer = $derived(readSettings(tileSettings));
	const status = $derived(statusOf(timer, now));
	const remaining = $derived(remainingMs(timer, now));
	const fraction = $derived(progress(timer, now));
	const dots = $derived(timer.mode === 'pomodoro' ? streak(timer) : []);

	/** Transient, and only transient: the persisted signal that a phase ran out
	 *  is `endsAt` sitting in the past, which is what survives a reload. This is
	 *  the banner shown once, until the user does something about it. */
	let finished = $state<{ away: boolean } | null>(null);

	/** Not `$state`: writing it must not re-trigger the effect that reads it,
	 *  which is the whole reason it exists. */
	let announcedFor: number | null = null;

	$effect(() => {
		// Notices a phase whose deadline has passed, exactly once per deadline.
		if (status !== 'finished') return;
		const endsAt = timer.endsAt;
		if (endsAt === null || announcedFor === endsAt) return;
		announcedFor = endsAt;

		untrack(() => void announce(timer, endsAt, now));
	});

	async function announce(settings: TpTimerSettings, endsAt: number, at: number): Promise<void> {
		const away = at - endsAt >= FRESH_MS;
		finished = { away };

		const { patch, logged } = complete(settings, at);
		onUpdateSettings?.(patch);

		if (logged !== null) {
			try {
				await logFocusSession(logged);
			} catch (error) {
				// A failed write must not take the tile down — the session is lost
				// from the history strip and nothing else.
				logEntry('warn', 'could not record a focus session', { src: 'widget', error });
			}
		}

		if (away) return;
		await playChime(settings.muted);
		if (settings.notify) notifyDone(m['widget.timer.title'](), phaseLabel(settings.phase));
	}

	function phaseLabel(phase: TpTimerPhase): string {
		if (phase === 'break') return m['widget.timer.phase.break']();
		if (phase === 'long-break') return m['widget.timer.phase.long_break']();
		return m['widget.timer.phase.focus']();
	}

	function onPrimary(): void {
		finished = null;
		const at = Date.now();
		onUpdateSettings?.(status === 'running' ? pause(timer, at) : start(timer, at));
	}

	function onReset(): void {
		finished = null;
		announcedFor = null;
		onUpdateSettings?.(reset());
	}

	/** doc 06 §3's `permission-needed`: asked for, and refused by the browser. */
	const permissionBlocked = $derived(timer.notify && notifyPermission() === 'denied');

	const readout = $derived(
		finished !== null && status === 'idle'
			? formatRemaining(phaseDurationMs(timer))
			: formatRemaining(remaining)
	);
</script>

<div class="tp-timer" data-tier={size.tier} data-status={status}>
	<div class="tp-timer__ring">
		<svg viewBox="0 0 100 100" role="presentation" aria-hidden="true">
			<circle class="tp-timer__track" cx="50" cy="50" r={RADIUS} />
			<circle
				class="tp-timer__fill"
				cx="50"
				cy="50"
				r={RADIUS}
				stroke-dasharray={CIRCUMFERENCE}
				stroke-dashoffset={CIRCUMFERENCE * (1 - fraction)}
				transform="rotate(-90 50 50)"
			/>
		</svg>
		<time class="tp-timer__readout tp-num" data-testid="timer-readout">{readout}</time>
	</div>

	<div class="tp-timer__side">
		{#if timer.mode === 'pomodoro'}
			<span class="tp-timer__chip" data-phase={timer.phase} data-testid="timer-phase">
				{phaseLabel(timer.phase)}
			</span>
			<ul
				class="tp-timer__dots"
				aria-label={m['widget.timer.cycle_progress']({
					done: timer.completed,
					total: timer.cycleLength
				})}
			>
				{#each dots as done, index (index)}
					<li class:done></li>
				{/each}
			</ul>
		{/if}

		{#if finished !== null}
			<!-- doc 07 §2: a phase that ran out while the machine slept says so, and
			     never starts the next one by itself. -->
			<p class="tp-timer__finished" role="status" data-testid="timer-finished">
				{finished.away ? m['widget.timer.finished_away']() : m['widget.timer.finished']()}
			</p>
		{/if}

		{#if permissionBlocked}
			<p class="tp-timer__blocked" data-testid="timer-permission">
				{m['widget.timer.permission_blocked']()}
			</p>
		{/if}

		<div class="tp-timer__controls">
			<button
				type="button"
				class="tp-timer__primary"
				data-testid="timer-primary"
				onclick={onPrimary}
			>
				{#if status === 'running'}
					{m['widget.timer.pause']()}
				{:else if status === 'paused'}
					{m['widget.timer.resume']()}
				{:else if finished !== null && timer.mode === 'pomodoro'}
					{m['widget.timer.start_next']({ phase: phaseLabel(timer.phase) })}
				{:else}
					{m['widget.timer.start']()}
				{/if}
			</button>
			<button type="button" class="tp-timer__ghost" data-testid="timer-reset" onclick={onReset}>
				{m['widget.timer.reset']()}
			</button>
		</div>
	</div>
</div>

<style>
	.tp-timer {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: 100%;
		overflow: hidden;
	}

	.tp-timer__ring {
		position: relative;
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: clamp(64px, 34%, 108px);
		aspect-ratio: 1;
	}

	.tp-timer__ring svg {
		width: 100%;
		height: 100%;
	}

	.tp-timer__track,
	.tp-timer__fill {
		fill: none;
		stroke-width: 6;
	}

	.tp-timer__track {
		stroke: var(--color-ink-700);
	}

	.tp-timer__fill {
		stroke: var(--color-beacon);
		stroke-linecap: round;
		transition: stroke-dashoffset 480ms linear;
	}

	:global(html[data-motion='reduced']) .tp-timer__fill {
		transition: none;
	}

	.tp-timer[data-status='finished'] .tp-timer__fill {
		stroke: var(--color-warn);
	}

	.tp-timer__readout {
		position: absolute;
		color: var(--color-fg);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	.tp-timer[data-tier='L'] .tp-timer__readout {
		font-size: var(--text-base);
	}

	.tp-timer__side {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
	}

	.tp-timer__chip {
		border-radius: var(--radius-ctl);
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
		font-size: var(--text-2xs);
		padding: 0.1rem 0.4rem;
	}

	.tp-timer__chip[data-phase='break'],
	.tp-timer__chip[data-phase='long-break'] {
		background: color-mix(in oklch, var(--color-warn) 14%, transparent);
		color: var(--color-warn);
	}

	.tp-timer__dots {
		display: flex;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-timer__dots li {
		width: 6px;
		height: 6px;
		border: 1px solid var(--color-ink-500);
		border-radius: 50%;
	}

	.tp-timer__dots li.done {
		border-color: var(--color-beacon);
		background: var(--color-beacon);
	}

	.tp-timer__finished {
		margin: 0;
		color: var(--color-warn);
		font-size: var(--text-2xs);
	}

	.tp-timer__blocked {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-timer__controls {
		display: flex;
		gap: 0.375rem;
		margin-top: auto;
		flex-wrap: wrap;
	}

	.tp-timer__primary,
	.tp-timer__ghost {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 32px;
		padding: 0 0.6rem;
	}

	.tp-timer__primary {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	.tp-timer__ghost {
		color: var(--color-fg-dim);
	}
</style>
