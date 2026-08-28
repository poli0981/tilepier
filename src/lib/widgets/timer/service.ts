import { dateKeyOf, dayKeysBack } from '$lib/core/date-key';
import { newId } from '$lib/core/ids';
import { db, type TpDb } from '$lib/core/storage/db';
import {
	MAX_DURATION_MS,
	MAX_PRESETS,
	MIN_DURATION_MS,
	TIMER_DEFAULTS,
	type TpTimerMode,
	type TpTimerPhase,
	type TpTimerSettings
} from './types';

/**
 * doc 07 §2's timing rules, as pure functions over `(settings, now)`.
 *
 * Nothing here reads a clock of its own: `now` is always a parameter. That is
 * what makes "the machine slept through the deadline" a case a test can state
 * rather than a case you have to close a laptop to reach.
 */

/* ───────────────────────────────────────────────── reading stored settings */

function clampDuration(value: unknown, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(value)));
}

function isMode(value: unknown): value is TpTimerMode {
	return value === 'countdown' || value === 'pomodoro';
}

function isPhase(value: unknown): value is TpTimerPhase {
	return value === 'focus' || value === 'break' || value === 'long-break';
}

/**
 * Reads the tile's settings bag into a complete, sane `TpTimerSettings`.
 *
 * Hand-written and total, like every other reader of stored data in this
 * codebase (doc 05 §5 forbids a runtime schema dependency): a settings bag can
 * be empty on first add, half-written by an older build, or edited by hand in
 * devtools, and none of those may produce a timer that counts to NaN.
 */
export function readSettings(raw: Record<string, unknown>): TpTimerSettings {
	const presets = Array.isArray(raw['presets'])
		? [
				...new Set(
					raw['presets']
						.filter((entry): entry is number => typeof entry === 'number')
						.map((entry) => clampDuration(entry, TIMER_DEFAULTS.durationMs))
				)
			]
				.sort((a, b) => a - b)
				.slice(0, MAX_PRESETS)
		: [...TIMER_DEFAULTS.presets];

	// A deadline in the far past is not wrong — it is exactly doc 07 §2's
	// "finished while away". Only a non-number is rejected.
	const endsAt =
		typeof raw['endsAt'] === 'number' && Number.isFinite(raw['endsAt']) ? raw['endsAt'] : null;
	const pausedMs =
		typeof raw['pausedMs'] === 'number' && Number.isFinite(raw['pausedMs'])
			? Math.max(0, raw['pausedMs'])
			: null;

	return {
		mode: isMode(raw['mode']) ? raw['mode'] : TIMER_DEFAULTS.mode,
		durationMs: clampDuration(raw['durationMs'], TIMER_DEFAULTS.durationMs),
		presets: presets.length > 0 ? presets : [...TIMER_DEFAULTS.presets],
		focusMs: clampDuration(raw['focusMs'], TIMER_DEFAULTS.focusMs),
		breakMs: clampDuration(raw['breakMs'], TIMER_DEFAULTS.breakMs),
		longBreakMs: clampDuration(raw['longBreakMs'], TIMER_DEFAULTS.longBreakMs),
		cycleLength:
			typeof raw['cycleLength'] === 'number' && raw['cycleLength'] >= 2 && raw['cycleLength'] <= 12
				? Math.round(raw['cycleLength'])
				: TIMER_DEFAULTS.cycleLength,
		// Running and paused are mutually exclusive; a bag carrying both is
		// resolved toward running, because that is the state with a deadline in
		// it and therefore the one that can still be checked against the clock.
		endsAt,
		pausedMs: endsAt === null ? pausedMs : null,
		phase: isPhase(raw['phase']) ? raw['phase'] : TIMER_DEFAULTS.phase,
		completed:
			typeof raw['completed'] === 'number' && raw['completed'] >= 0
				? Math.round(raw['completed'])
				: 0,
		muted: raw['muted'] === true,
		notify: raw['notify'] === true
	};
}

/* ──────────────────────────────────────────────────────── the state machine */

export type TpTimerStatus = 'idle' | 'running' | 'paused' | 'finished';

/** How long the current phase is meant to last, before any of it has run. */
export function phaseDurationMs(settings: TpTimerSettings): number {
	if (settings.mode === 'countdown') return settings.durationMs;
	if (settings.phase === 'break') return settings.breakMs;
	if (settings.phase === 'long-break') return settings.longBreakMs;
	return settings.focusMs;
}

export function statusOf(settings: TpTimerSettings, now: number): TpTimerStatus {
	if (settings.endsAt !== null) return now >= settings.endsAt ? 'finished' : 'running';
	if (settings.pausedMs !== null) return 'paused';
	return 'idle';
}

/** Never negative, and never larger than the phase — a clamp rather than raw
 *  arithmetic, because both ends show up on screen as a ring fraction. */
export function remainingMs(settings: TpTimerSettings, now: number): number {
	const total = phaseDurationMs(settings);
	if (settings.endsAt !== null) return Math.min(total, Math.max(0, settings.endsAt - now));
	if (settings.pausedMs !== null) return Math.min(total, settings.pausedMs);
	return total;
}

/** 0 at the start of a phase, 1 at its end. What the ring draws. */
export function progress(settings: TpTimerSettings, now: number): number {
	const total = phaseDurationMs(settings);
	if (total <= 0) return 1;
	return 1 - remainingMs(settings, now) / total;
}

/** Partial patches throughout: the caller hands these straight to
 *  `onUpdateSettings`, which merges into the tile's bag (doc 06 §2). */
type Patch = Partial<TpTimerSettings>;

export function start(settings: TpTimerSettings, now: number): Patch {
	// Resuming from a pause keeps the remainder; starting fresh takes the whole
	// phase. One entry point rather than two, because the button is one button.
	const remaining = settings.pausedMs ?? phaseDurationMs(settings);
	return { endsAt: now + remaining, pausedMs: null };
}

export function pause(settings: TpTimerSettings, now: number): Patch {
	if (settings.endsAt === null) return {};
	return { endsAt: null, pausedMs: Math.max(0, settings.endsAt - now) };
}

/** Back to the top of the current phase, still stopped. */
export function reset(): Patch {
	return { endsAt: null, pausedMs: null };
}

/** Out of pomodoro entirely: phase and cycle counter back to the start. */
export function resetCycle(): Patch {
	return { endsAt: null, pausedMs: null, phase: 'focus', completed: 0 };
}

/**
 * Advances past a phase that has run out.
 *
 * **It does not start the next one.** doc 07 §2 is explicit: waking a machine
 * that slept through a deadline must show "finished while away", not silently
 * begin a focus session the user was not present for. So this only moves the
 * phase and returns the session worth logging; something has to press start.
 */
export function complete(
	settings: TpTimerSettings,
	now: number
): { patch: Patch; logged: { dateKey: string; focusMs: number } | null } {
	if (settings.mode === 'countdown') {
		return { patch: reset(), logged: null };
	}

	if (settings.phase !== 'focus') {
		// A break ending always returns to focus, long or short alike.
		return { patch: { endsAt: null, pausedMs: null, phase: 'focus' }, logged: null };
	}

	const completed = settings.completed + 1;
	const longBreakDue = completed % settings.cycleLength === 0;

	return {
		patch: {
			endsAt: null,
			pausedMs: null,
			phase: longBreakDue ? 'long-break' : 'break',
			// The counter is what drives the streak dots, so it keeps climbing
			// through the long break and resets when the next cycle opens.
			completed: longBreakDue ? 0 : completed
		},
		// Credited to `endsAt` rather than to `now`. They are the same instant
		// when the tab is awake, and very different when it is not: a session
		// that finished at 23:50 and is noticed at 08:00 the next morning
		// belongs to the day it finished, not to the day someone looked. `now`
		// is the fallback for a phase completed by hand before its deadline.
		logged: { dateKey: dateKeyOf(settings.endsAt ?? now), focusMs: settings.focusMs }
	};
}

/**
 * `mm:ss`, or `h:mm:ss` past an hour — the countdown readout (doc 07 §2).
 *
 * Rounded **up**, which is what makes a countdown read correctly: with 900 ms
 * left, a floor shows `0:00` for most of a second while the timer is still
 * running, and the last second appears to be missing. Up means the display
 * reaches zero exactly when the timer does.
 */
export function formatRemaining(ms: number): string {
	const total = Math.ceil(Math.max(0, ms) / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = total % 60;
	const pad = (value: number) => String(value).padStart(2, '0');

	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Streak dots for today's cycle (doc 07 §2): filled up to `completed`. */
export function streak(settings: TpTimerSettings): readonly boolean[] {
	return Array.from({ length: settings.cycleLength }, (_, i) => i < settings.completed);
}

/* ─────────────────────────────────────────────────────────── focus history */

export async function logFocusSession(
	session: { dateKey: string; focusMs: number },
	target: TpDb = db
): Promise<void> {
	await target.focusSessions.add({ id: newId('fs'), ...session });
}

export interface TpFocusDay {
	dateKey: string;
	focusMs: number;
}

/** doc 07 §2's history strip. */
export const HISTORY_DAYS = 14;

/**
 * The last `days` days of focus time, oldest first, **including the empty
 * ones**. A sparkline with gaps in it is a sparkline that lies about its own
 * x-axis: fourteen bars always means fourteen days.
 */
export async function focusHistory(
	now: number = Date.now(),
	days: number = HISTORY_DAYS,
	target: TpDb = db
): Promise<TpFocusDay[]> {
	const keys = dayKeysBack(now, days);

	const totals = new Map(keys.map((key) => [key, 0]));
	const rows = await target.focusSessions
		.where('dateKey')
		.between(keys[0] ?? '', keys[keys.length - 1] ?? '', true, true)
		.toArray();

	for (const row of rows) {
		const current = totals.get(row.dateKey);
		if (current !== undefined) totals.set(row.dateKey, current + row.focusMs);
	}

	return keys.map((dateKey) => ({ dateKey, focusMs: totals.get(dateKey) ?? 0 }));
}
