import type { TpLunarDate, TpSolarDate } from '$lib/lunar/amlich';

/** doc 07 §6. */

export interface TpCalendarCell {
	/** doc 05 §3's `events` key — the viewer's own calendar date. */
	dateKey: string;
	date: TpSolarDate;
	/** False for the leading and trailing days that fill out the first and last
	 *  weeks. They are still real dates and still carry their lunar day. */
	inMonth: boolean;
	isToday: boolean;
	/** `null` only outside the lunar module's supported range (doc 07 §6). */
	lunar: TpLunarDate | null;
	/**
	 * The lunar month boundaries doc 07 §6 accents. `mung-mot` is the new moon
	 * that opens a lunar month, `ram` the full moon at its middle — the two days
	 * a Vietnamese reader looks for first. Inline rather than a named type:
	 * every reader of it goes through `TpCalendarCell`, and knip is CI-blocking
	 * on an exported type nothing imports (doc 20 §4).
	 */
	accent: 'mung-mot' | 'ram' | null;
}

export interface TpCalendarMonth {
	year: number;
	/** 1–12, not the `Date` API's 0–11. Every function here speaks the human
	 *  numbering, because half of them are also formatting it. */
	month: number;
	/** Whole weeks — 28, 35 or 42 cells, never a ragged first row. */
	cells: readonly TpCalendarCell[];
	/** The Dexie range covering the grid, inclusive at both ends. */
	fromKey: string;
	toKey: string;
}

/**
 * Per-instance settings (doc 05 §2).
 *
 * One field, and it is doc 14 §3's: "Can-Chi rendered only in vi by default
 * with a toggle in calendar settings". The lunar overlay on the grid itself is
 * not a setting — doc 07 §6 keys it to the locale.
 */
export interface TpCalendarSettings {
	canChi: boolean;
}

/** What the detail's editor round-trips. `dateKey` moves an event between days. */
export interface TpEventDraft {
	dateKey: string;
	title: string;
	note?: string;
}

/** doc 05 §3 stores whatever it is given; these are what the UI will accept. */
export const EVENT_LIMITS = {
	titleMax: 120,
	noteMax: 500
} as const;
