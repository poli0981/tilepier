/**
 * doc 07 §2. Everything here lives in the tile's `settings` inside
 * `tp.layout.v1` (doc 05 §2) — including the *running* state.
 *
 * That last part is a decision, not an accident. A countdown is
 * deadline-based: what makes it correct across a throttled tab, a reload, or a
 * closed laptop lid is that `endsAt` is an absolute instant rather than a
 * number being decremented. Storing it is what lets doc 07 §2's "finished
 * while away" case exist at all — a timer kept in component state has nothing
 * to compare against when the machine wakes up, because it did not survive to
 * ask. It also means a running timer rides along in the backup export with the
 * rest of the layout, at no extra cost.
 */

export type TpTimerMode = 'countdown' | 'pomodoro';

/** Pomodoro only. A countdown has no phases — it is one interval. */
export type TpTimerPhase = 'focus' | 'break' | 'long-break';

export interface TpTimerSettings {
	mode: TpTimerMode;

	/** Countdown: the selected duration, and the editable preset row. */
	durationMs: number;
	presets: readonly number[];

	/** Pomodoro configuration. */
	focusMs: number;
	breakMs: number;
	longBreakMs: number;
	/** Focus sessions before a long break. */
	cycleLength: number;

	/**
	 * Absolute instant the current run ends, or `null` when nothing is running.
	 * Never a duration — see the note above.
	 */
	endsAt: number | null;
	/** Set when paused, cleared when running. The two are mutually exclusive:
	 *  a paused timer has a remainder but no deadline. */
	pausedMs: number | null;
	phase: TpTimerPhase;
	/** Focus sessions completed in the current cycle; resets after a long break. */
	completed: number;

	/** doc 07 §2: the completion cue respects a mute setting. */
	muted: boolean;
	/** Whether the user asked for a Notification on completion. The browser
	 *  permission is a separate question and is never inferred from this. */
	notify: boolean;
}

const MINUTE = 60_000;

/** doc 07 §2's defaults: a 25/5 pomodoro on a four-session cycle. */
export const TIMER_DEFAULTS: TpTimerSettings = {
	mode: 'countdown',
	durationMs: 5 * MINUTE,
	presets: [MINUTE, 3 * MINUTE, 5 * MINUTE, 10 * MINUTE, 25 * MINUTE],
	focusMs: 25 * MINUTE,
	breakMs: 5 * MINUTE,
	longBreakMs: 15 * MINUTE,
	cycleLength: 4,
	endsAt: null,
	pausedMs: null,
	phase: 'focus',
	completed: 0,
	muted: false,
	notify: false
};

/** Bounds for anything the user can type. A duration of zero would fire
 *  instantly and forever; one of a year would silently never fire. */
export const MIN_DURATION_MS = 10_000;
export const MAX_DURATION_MS = 24 * 60 * MINUTE;
export const MAX_PRESETS = 6;
