/**
 * `YYYY-MM-DD` in the viewer's own zone — the key doc 05 §3 gives `events` and
 * `focusSessions`, and the string `todos.due` is compared against.
 *
 * Local rather than UTC on purpose. "Is this due today", "how much did I focus
 * today" and "which cell is today" are all questions about the *user's* day,
 * and a UTC key would move that boundary by up to fourteen hours depending on
 * where they are. Built from `Date` parts rather than `toISOString()`, which is
 * UTC by definition and is exactly how this goes wrong.
 *
 * Lived in `widgets/timer/service.ts` and `widgets/todo/service.ts` — two
 * identical copies, each carrying a comment saying so — until the calendar
 * became the third caller. doc 03 §1 moves reuse into `core` when there *is*
 * reuse rather than in anticipation, so this is that move rather than a
 * primitive added on spec.
 */

/** Zero-padded, so the keys sort lexicographically — Dexie ranges over this
 *  index, and unpadded months would order 10 before 2. */
export function dateKeyOf(at: number | Date): string {
	const date = at instanceof Date ? at : new Date(at);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The `days` day-keys ending at `now`, oldest first and including today.
 *
 * Walked with `setDate()`, not by subtracting 86 400 000 ms. A local day is not
 * always 24 hours: on the day clocks go back it is 25, and fixed-millisecond
 * arithmetic from local midnight then lands at 23:00 of the day *before* the
 * one it meant — skipping a date and repeating another, twice a year.
 * `setDate` is calendar arithmetic and absorbs it, the same way
 * `scheduler.nextMidnight` uses `setHours(24)`.
 */
export function dayKeysBack(now: number | Date, days: number): string[] {
	const keys: string[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = now instanceof Date ? new Date(now.getTime()) : new Date(now);
		day.setHours(0, 0, 0, 0);
		day.setDate(day.getDate() - i);
		keys.push(dateKeyOf(day));
	}
	return keys;
}
