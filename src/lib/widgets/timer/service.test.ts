import { describe, expect, it } from 'vitest';
import { dateKeyOf } from '$lib/core/date-key';
import {
	complete,
	formatRemaining,
	pause,
	phaseDurationMs,
	progress,
	readSettings,
	remainingMs,
	reset,
	resetCycle,
	start,
	statusOf,
	streak
} from './service';
import { MAX_DURATION_MS, MIN_DURATION_MS, TIMER_DEFAULTS, type TpTimerSettings } from './types';

/**
 * doc 07 §2. `now` is a parameter everywhere in this module, which is what
 * makes the interesting case — a machine that slept straight through the
 * deadline — something a test can simply state.
 */

const MINUTE = 60_000;
const T0 = Date.parse('2026-08-27T09:00:00Z');

function settings(overrides: Partial<TpTimerSettings> = {}): TpTimerSettings {
	return { ...TIMER_DEFAULTS, ...overrides };
}

describe('readSettings', () => {
	it('fills an empty bag with the defaults', () => {
		// What a freshly added tile hands it.
		expect(readSettings({})).toEqual(TIMER_DEFAULTS);
	});

	it('clamps a duration into the allowed range', () => {
		expect(readSettings({ durationMs: 1 }).durationMs).toBe(MIN_DURATION_MS);
		expect(readSettings({ durationMs: 10 ** 12 }).durationMs).toBe(MAX_DURATION_MS);
	});

	it('falls back rather than producing NaN', () => {
		// A hand-edited layout, or a half-written bag from an older build.
		expect(readSettings({ durationMs: 'soon' }).durationMs).toBe(TIMER_DEFAULTS.durationMs);
		expect(readSettings({ durationMs: Number.NaN }).durationMs).toBe(TIMER_DEFAULTS.durationMs);
		expect(readSettings({ mode: 'stopwatch' }).mode).toBe(TIMER_DEFAULTS.mode);
		expect(readSettings({ phase: 'nap' }).phase).toBe(TIMER_DEFAULTS.phase);
	});

	it('sorts, dedupes and caps the presets', () => {
		const presets = readSettings({
			presets: [5 * MINUTE, MINUTE, 5 * MINUTE, 'ten', 3 * MINUTE]
		}).presets;

		expect(presets).toEqual([MINUTE, 3 * MINUTE, 5 * MINUTE]);
	});

	it('keeps a deadline that has already passed', () => {
		// Not corruption — this is precisely doc 07 §2's "finished while away".
		const past = T0 - 60 * MINUTE;
		expect(readSettings({ endsAt: past }).endsAt).toBe(past);
	});

	it('resolves a bag that claims to be both running and paused', () => {
		// Running wins: it is the state with a deadline in it, and therefore the
		// only one that can still be checked against the clock.
		const read = readSettings({ endsAt: T0 + MINUTE, pausedMs: 30_000 });
		expect(read.endsAt).toBe(T0 + MINUTE);
		expect(read.pausedMs).toBeNull();
	});
});

describe('phase duration', () => {
	it('is the countdown duration in countdown mode, whatever the phase says', () => {
		expect(phaseDurationMs(settings({ mode: 'countdown', phase: 'break' }))).toBe(
			TIMER_DEFAULTS.durationMs
		);
	});

	it('follows the phase in pomodoro mode', () => {
		const base = settings({ mode: 'pomodoro' });
		expect(phaseDurationMs({ ...base, phase: 'focus' })).toBe(base.focusMs);
		expect(phaseDurationMs({ ...base, phase: 'break' })).toBe(base.breakMs);
		expect(phaseDurationMs({ ...base, phase: 'long-break' })).toBe(base.longBreakMs);
	});
});

describe('status and remaining', () => {
	it('is idle with no deadline and no remainder', () => {
		expect(statusOf(settings(), T0)).toBe('idle');
		expect(remainingMs(settings(), T0)).toBe(TIMER_DEFAULTS.durationMs);
	});

	it('counts down from an absolute deadline', () => {
		const running = settings({ endsAt: T0 + 3 * MINUTE, durationMs: 5 * MINUTE });
		expect(statusOf(running, T0)).toBe('running');
		expect(remainingMs(running, T0)).toBe(3 * MINUTE);
		expect(remainingMs(running, T0 + MINUTE)).toBe(2 * MINUTE);
	});

	it('reports finished the moment the deadline passes, not a tick later', () => {
		const running = settings({ endsAt: T0 });
		expect(statusOf(running, T0 - 1)).toBe('running');
		expect(statusOf(running, T0)).toBe('finished');
	});

	it('is still finished after the machine slept through it', () => {
		// The case doc 07 §2 names. Nine hours late is the same answer as one
		// millisecond late, and the remainder never goes negative.
		const slept = settings({ endsAt: T0, durationMs: 5 * MINUTE });
		const wake = T0 + 9 * 60 * MINUTE;

		expect(statusOf(slept, wake)).toBe('finished');
		expect(remainingMs(slept, wake)).toBe(0);
		expect(progress(slept, wake)).toBe(1);
	});

	it('holds its remainder while paused', () => {
		const paused = settings({ pausedMs: 90_000, durationMs: 5 * MINUTE });
		expect(statusOf(paused, T0)).toBe('paused');
		// Time passing must not move a paused timer.
		expect(remainingMs(paused, T0 + 10 * MINUTE)).toBe(90_000);
	});

	it('reports progress from 0 to 1 across the phase', () => {
		const running = settings({ endsAt: T0 + 5 * MINUTE, durationMs: 10 * MINUTE });
		expect(progress(running, T0)).toBeCloseTo(0.5, 6);
		expect(progress(settings({ durationMs: 10 * MINUTE }), T0)).toBe(0);
	});
});

describe('start, pause, resume', () => {
	it('starts a fresh phase from its full duration', () => {
		expect(start(settings({ durationMs: 5 * MINUTE }), T0)).toEqual({
			endsAt: T0 + 5 * MINUTE,
			pausedMs: null
		});
	});

	it('pauses to a remainder and resumes from it', () => {
		const running = settings({ endsAt: T0 + 5 * MINUTE, durationMs: 5 * MINUTE });

		const paused = { ...running, ...pause(running, T0 + 2 * MINUTE) };
		expect(paused.endsAt).toBeNull();
		expect(paused.pausedMs).toBe(3 * MINUTE);

		// Resumed an hour later, it still has three minutes to run — the whole
		// point of holding a remainder rather than a deadline while paused.
		const resumed = { ...paused, ...start(paused, T0 + 60 * MINUTE) };
		expect(resumed.endsAt).toBe(T0 + 63 * MINUTE);
		expect(resumed.pausedMs).toBeNull();
	});

	it('does nothing when asked to pause something already stopped', () => {
		expect(pause(settings(), T0)).toEqual({});
	});

	it('never pauses to a negative remainder', () => {
		const overdue = settings({ endsAt: T0 });
		expect(pause(overdue, T0 + 10 * MINUTE)).toEqual({ endsAt: null, pausedMs: 0 });
	});

	it('resets to the top of the phase without touching the cycle', () => {
		expect(reset()).toEqual({ endsAt: null, pausedMs: null });
	});

	it('resets the whole cycle when asked', () => {
		expect(resetCycle()).toEqual({
			endsAt: null,
			pausedMs: null,
			phase: 'focus',
			completed: 0
		});
	});
});

describe('complete', () => {
	it('logs nothing and simply stops, in countdown mode', () => {
		const result = complete(settings({ mode: 'countdown', endsAt: T0 }), T0);
		expect(result.logged).toBeNull();
		expect(result.patch).toEqual({ endsAt: null, pausedMs: null });
	});

	it('moves focus to a break and logs the session', () => {
		const focus = settings({ mode: 'pomodoro', phase: 'focus', completed: 0, endsAt: T0 });
		const result = complete(focus, T0);

		expect(result.patch.phase).toBe('break');
		expect(result.patch.completed).toBe(1);
		expect(result.logged).toEqual({ dateKey: dateKeyOf(T0), focusMs: focus.focusMs });
	});

	it('moves a break back to focus without logging', () => {
		// A break is not focus time; logging it would inflate the history strip.
		for (const phase of ['break', 'long-break'] as const) {
			const result = complete(settings({ mode: 'pomodoro', phase, endsAt: T0 }), T0);
			expect(result.patch.phase, phase).toBe('focus');
			expect(result.logged, phase).toBeNull();
		}
	});

	it('takes a long break at the end of a cycle and starts the count over', () => {
		const fourth = settings({
			mode: 'pomodoro',
			phase: 'focus',
			completed: 3,
			cycleLength: 4,
			endsAt: T0
		});
		const result = complete(fourth, T0);

		expect(result.patch.phase).toBe('long-break');
		expect(result.patch.completed).toBe(0);
		// The session still counts toward the history even though the streak
		// dots have just cleared.
		expect(result.logged?.focusMs).toBe(fourth.focusMs);
	});

	it('never starts the next phase itself', () => {
		// doc 07 §2: waking a slept-through machine must not silently begin a
		// focus session nobody was present for. Every patch leaves it stopped.
		const wake = T0 + 9 * 60 * MINUTE;
		for (const phase of ['focus', 'break', 'long-break'] as const) {
			const result = complete(settings({ mode: 'pomodoro', phase, endsAt: T0 }), wake);
			expect(result.patch.endsAt, phase).toBeNull();
			expect(result.patch.pausedMs, phase).toBeNull();
		}
	});

	it('credits a session to when it ended, not to when a tab noticed', () => {
		// Finished at 23:50, seen at 08:00 the next morning. It belongs to the
		// day it finished — otherwise closing a laptop moves yesterday's focus
		// onto today's bar.
		const endedAt = new Date(2026, 7, 27, 23, 50).getTime();
		const noticedAt = new Date(2026, 7, 28, 8, 0).getTime();

		const result = complete(
			settings({ mode: 'pomodoro', phase: 'focus', endsAt: endedAt }),
			noticedAt
		);

		expect(result.logged?.dateKey).toBe('2026-08-27');
	});

	it('falls back to now for a phase completed before its deadline', () => {
		const at = new Date(2026, 7, 28, 10, 0).getTime();
		const result = complete(settings({ mode: 'pomodoro', phase: 'focus', endsAt: null }), at);
		expect(result.logged?.dateKey).toBe('2026-08-28');
	});
});

describe('streak', () => {
	it('fills one dot per completed session, out of the cycle length', () => {
		expect(streak(settings({ cycleLength: 4, completed: 2 }))).toEqual([true, true, false, false]);
		expect(streak(settings({ cycleLength: 4, completed: 0 }))).toEqual([
			false,
			false,
			false,
			false
		]);
	});
});

describe('formatRemaining', () => {
	it('reads mm:ss below an hour and h:mm:ss above it', () => {
		expect(formatRemaining(90_000)).toBe('1:30');
		expect(formatRemaining(25 * MINUTE)).toBe('25:00');
		expect(formatRemaining(90 * MINUTE)).toBe('1:30:00');
	});

	it('rounds up, so the last second is not missing', () => {
		// With 900 ms left the timer is still running; a floor would show 0:00
		// for most of a second and the display would reach zero early.
		expect(formatRemaining(900)).toBe('0:01');
		expect(formatRemaining(1)).toBe('0:01');
		expect(formatRemaining(0)).toBe('0:00');
	});

	it('never shows a negative time', () => {
		expect(formatRemaining(-5000)).toBe('0:00');
	});
});
