import { dateKeyOf } from '$lib/core/date-key';
import { newId } from '$lib/core/ids';
import { db, type TpDb, type TpEvent } from '$lib/core/storage/db';
import { lunarOfDate, type TpLunarDate } from '$lib/lunar/amlich';
import {
	EVENT_LIMITS,
	type TpCalendarCell,
	type TpCalendarMonth,
	type TpCalendarSettings,
	type TpEventDraft
} from './types';

/**
 * doc 07 §6's data layer — the month grid, and the `events` table under it.
 *
 * The grid is a pure function of `(year, month, weekStartsOn, now)`. That is
 * what lets it be tested against fixed dates rather than against whenever the
 * suite happens to run, and it is why the lunar overlay is computed here rather
 * than in the component: a cell is one record, and half of what it says comes
 * from Dexie and half from the astronomy.
 *
 * **A cell's date is the viewer's own; its lunar date is pinned to UTC+7.**
 * Those are two different questions and doc 07 §6 only pins the second (see
 * `lib/lunar/README.md`). Events are keyed on the first, like `todos.due` and
 * `focusSessions.dateKey` before them — "what is on today" is a question about
 * the user's day.
 */

/* ──────────────────────────────────────────────────────────────── settings */

/**
 * doc 14 §3: can-chi shows in Vietnamese by default and is a toggle either way.
 * The default is the locale's rather than a constant, so an English reader gets
 * a plain calendar until they ask for one that is not.
 */
export function readSettings(
	bag: Record<string, unknown>,
	locale: 'vi' | 'en'
): TpCalendarSettings {
	const stored = bag['canChi'];
	return { canChi: typeof stored === 'boolean' ? stored : locale === 'vi' };
}

/* ────────────────────────────────────────────────────────────── month grid */

/** `{ year, month }` moved by whole months, with the year carrying correctly. */
export function shiftMonth(
	year: number,
	month: number,
	delta: number
): { year: number; month: number } {
	// Through `Date` rather than by hand: the modulo arithmetic for a negative
	// delta across a year boundary is exactly the kind that looks right and is
	// off by one for December.
	const at = new Date(year, month - 1 + delta, 1);
	return { year: at.getFullYear(), month: at.getMonth() + 1 };
}

/**
 * A month as whole weeks, starting on `weekStartsOn` (0 = Sunday, doc 05 §2).
 *
 * The leading and trailing cells are real dates from the neighbouring months,
 * not blanks: they carry their own lunar day, because a lunar month boundary
 * lands on them as readily as anywhere else and a grid that greyed them out
 * entirely would drop a mùng 1 every so often.
 */
export function monthGrid(
	year: number,
	month: number,
	weekStartsOn: number,
	now: number | Date = Date.now()
): TpCalendarMonth {
	const first = new Date(year, month - 1, 1);
	const lead = (first.getDay() - weekStartsOn + 7) % 7;
	// Day 0 of the next month is the last day of this one.
	const daysInMonth = new Date(year, month, 0).getDate();
	const total = Math.ceil((lead + daysInMonth) / 7) * 7;

	const todayKey = dateKeyOf(now);
	const cells: TpCalendarCell[] = [];

	for (let i = 0; i < total; i++) {
		// Constructed by day offset from the 1st rather than by adding
		// milliseconds, so a DST day of 23 or 25 hours cannot shift a cell
		// (the same reason `dayKeysBack` walks with `setDate`).
		const at = new Date(year, month - 1, 1 - lead + i);
		const date = { d: at.getDate(), m: at.getMonth() + 1, y: at.getFullYear() };
		const lunar = lunarOfDate(date);
		const dateKey = dateKeyOf(at);

		cells.push({
			dateKey,
			date,
			inMonth: date.y === year && date.m === month,
			isToday: dateKey === todayKey,
			lunar,
			accent: accentOf(lunar)
		});
	}

	return {
		year,
		month,
		cells,
		fromKey: cells[0]?.dateKey ?? '',
		toKey: cells[cells.length - 1]?.dateKey ?? ''
	};
}

function accentOf(lunar: TpLunarDate | null): TpCalendarCell['accent'] {
	if (lunar === null) return null;
	if (lunar.day === 1) return 'mung-mot';
	if (lunar.day === 15) return 'ram';
	return null;
}

/**
 * The lunar months a solar month spans — one label or two, for the header that
 * doc 07 §6 asks to carry "solar + lunar month labels".
 *
 * Read off the in-month cells only. The leading and trailing days belong to the
 * neighbouring solar months, and letting them widen the label would make August
 * claim to span three lunar months when it spans two.
 */
export function lunarMonthSpan(grid: TpCalendarMonth): readonly TpLunarDate[] {
	const seen: TpLunarDate[] = [];
	for (const cell of grid.cells) {
		if (!cell.inMonth || cell.lunar === null) continue;
		const last = seen[seen.length - 1];
		if (last !== undefined && last.month === cell.lunar.month && last.leap === cell.lunar.leap) {
			continue;
		}
		seen.push(cell.lunar);
	}
	return seen;
}

/**
 * Weekday headers, through `Intl` (doc 14 §3: never hand-roll).
 *
 * The reference week is 7–13 January 2024, which starts on a Sunday — so index
 * 0 of it is weekday 0 and the rotation by `weekStartsOn` is a plain offset.
 * `narrow` gives Vietnamese `CN T2 T3 …`, which is what a mini-grid has room
 * for; the detail asks for `short`.
 */
export function weekdayLabels(
	locale: string,
	weekStartsOn: number,
	width: 'narrow' | 'short' = 'narrow'
): string[] {
	const fmt = new Intl.DateTimeFormat(locale, { weekday: width });
	return Array.from({ length: 7 }, (_, i) =>
		fmt.format(new Date(2024, 0, 7 + ((weekStartsOn + i) % 7)))
	);
}

/* ─────────────────────────────────────────────────────────────────── events */

export async function listEventsInRange(
	fromKey: string,
	toKey: string,
	target: TpDb = db
): Promise<TpEvent[]> {
	// `dateKey` is indexed and zero-padded, so a string range over it is both
	// exact and cheap — this is why doc 05 §3 indexes that column.
	return target.events.where('dateKey').between(fromKey, toKey, true, true).toArray();
}

export async function listEventsOn(dateKey: string, target: TpDb = db): Promise<TpEvent[]> {
	return target.events.where('dateKey').equals(dateKey).toArray();
}

/** Grid rendering wants "how many on this day" for every day at once. */
export function countByDateKey(events: readonly TpEvent[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const event of events) counts.set(event.dateKey, (counts.get(event.dateKey) ?? 0) + 1);
	return counts;
}

/**
 * Agenda order within a day, alphabetical by title.
 *
 * There is nothing better available and it is worth saying why rather than
 * leaving the choice looking arbitrary. `events` has no time field — doc 07 §6
 * makes v1 all-day only — and no `order` field either, and a shipped
 * `version(1)` block cannot gain one (CLAUDE.md rule 10). Insertion order is not
 * recoverable: `newId` draws from `crypto.getRandomValues`, so the primary-key
 * order Dexie returns is stable but arbitrary, which would scatter a newly added
 * event into the middle of the list. Alphabetical is stable, is the same on
 * every device, and puts a list somewhere a reader can scan.
 *
 * The id breaks ties so two events with the same title do not swap places
 * between renders.
 */
export function sortEvents(events: readonly TpEvent[], locale = 'vi'): TpEvent[] {
	return [...events].sort(
		(a, b) => a.title.localeCompare(b.title, locale) || a.id.localeCompare(b.id)
	);
}

/**
 * `null` for a blank title rather than an event with no name: doc 12 §8 asks
 * empty states to explain and offer one action, and an untitled row in an
 * agenda is neither.
 */
export async function createEvent(draft: TpEventDraft, target: TpDb = db): Promise<TpEvent | null> {
	const title = draft.title.trim().slice(0, EVENT_LIMITS.titleMax);
	if (title === '') return null;

	const note = draft.note?.trim().slice(0, EVENT_LIMITS.noteMax) ?? '';
	const event: TpEvent = {
		id: newId('evt'),
		dateKey: draft.dateKey,
		title,
		// doc 07 §5 rule 5: an absent optional is a missing key, not an
		// `undefined` — `exactOptionalPropertyTypes` forbids the assignment and
		// deletion is what an export then carries.
		...(note === '' ? {} : { note })
	};

	await target.events.add(event);
	return event;
}

/** Returns the stored row, or `null` when the edit would blank the title. */
export async function updateEvent(
	id: string,
	patch: Partial<TpEventDraft>,
	target: TpDb = db
): Promise<TpEvent | null> {
	const existing = await target.events.get(id);
	if (existing === undefined) return null;

	const title = (patch.title ?? existing.title).trim().slice(0, EVENT_LIMITS.titleMax);
	if (title === '') return null;

	const rawNote = patch.note === undefined ? existing.note : patch.note;
	const note = rawNote?.trim().slice(0, EVENT_LIMITS.noteMax) ?? '';

	const next: TpEvent = {
		id: existing.id,
		dateKey: patch.dateKey ?? existing.dateKey,
		title,
		...(note === '' ? {} : { note })
	};

	// `put` rather than `update`: a cleared note has to remove the key, and an
	// `update` with `{ note: undefined }` leaves the old value in place.
	await target.events.put(next);
	return next;
}

export async function deleteEvent(id: string, target: TpDb = db): Promise<void> {
	await target.events.delete(id);
}
