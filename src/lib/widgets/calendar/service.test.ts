import { describe, expect, it } from 'vitest';
import type { TpEvent } from '$lib/core/storage/db';
import {
	countByDateKey,
	lunarMonthSpan,
	monthGrid,
	readSettings,
	shiftMonth,
	sortEvents,
	weekdayLabels
} from './service';

/**
 * doc 07 §6's pure half — the grid, the labels and the ordering. The Dexie half
 * is in `storage.svelte.test.ts`, for the same reason the todo widget splits
 * them: real IndexedDB needs the browser project, and everything here does not.
 *
 * Every case fixes `now` explicitly. A calendar tested against `Date.now()` is
 * a calendar that passes until the first of the month.
 */

/** A Friday. Local constructor, so the assertions hold on a runner in any zone. */
const NOW = new Date(2026, 7, 28, 10, 0);

const event = (overrides: Partial<TpEvent> = {}): TpEvent => ({
	id: 'evt_a',
	dateKey: '2026-08-28',
	title: '',
	...overrides
});

describe('readSettings', () => {
	it('defaults can-chi on in Vietnamese and off in English (doc 14 §3)', () => {
		expect(readSettings({}, 'vi').canChi).toBe(true);
		expect(readSettings({}, 'en').canChi).toBe(false);
	});

	it('lets a stored choice override the locale in either direction', () => {
		expect(readSettings({ canChi: false }, 'vi').canChi).toBe(false);
		expect(readSettings({ canChi: true }, 'en').canChi).toBe(true);
	});

	it('ignores a stored value of the wrong type rather than trusting it', () => {
		// A settings bag is stored data and doc 05 §5's readers are total.
		expect(readSettings({ canChi: 'yes' }, 'vi').canChi).toBe(true);
		expect(readSettings({ canChi: null }, 'en').canChi).toBe(false);
	});
});

describe('shiftMonth', () => {
	it('moves within a year', () => {
		expect(shiftMonth(2026, 8, 1)).toEqual({ year: 2026, month: 9 });
		expect(shiftMonth(2026, 8, -1)).toEqual({ year: 2026, month: 7 });
	});

	it('carries the year in both directions', () => {
		expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
		expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
	});

	it('carries more than a year', () => {
		expect(shiftMonth(2026, 8, 14)).toEqual({ year: 2027, month: 10 });
		expect(shiftMonth(2026, 8, -20)).toEqual({ year: 2024, month: 12 });
	});
});

describe('monthGrid — shape', () => {
	it('produces whole weeks, never a ragged row', () => {
		for (let month = 1; month <= 12; month++) {
			for (const weekStartsOn of [0, 1]) {
				const grid = monthGrid(2026, month, weekStartsOn, NOW);
				expect(grid.cells.length % 7, `${String(month)}/${String(weekStartsOn)}`).toBe(0);
			}
		}
	});

	it('starts the grid on the configured first day of the week', () => {
		// August 2026 begins on a Saturday.
		expect(monthGrid(2026, 8, 1, NOW).cells[0]?.dateKey).toBe('2026-07-27'); // Monday
		expect(monthGrid(2026, 8, 0, NOW).cells[0]?.dateKey).toBe('2026-07-26'); // Sunday
	});

	it('contains every day of the month exactly once', () => {
		const grid = monthGrid(2026, 2, 1, NOW);
		const inMonth = grid.cells.filter((c) => c.inMonth).map((c) => c.dateKey);
		expect(inMonth.length).toBe(28);
		expect(new Set(inMonth).size).toBe(28);
		expect(inMonth[0]).toBe('2026-02-01');
		expect(inMonth[27]).toBe('2026-02-28');
	});

	it('handles a leap February', () => {
		const inMonth = monthGrid(2028, 2, 1, NOW).cells.filter((c) => c.inMonth);
		expect(inMonth.length).toBe(29);
		expect(inMonth[28]?.dateKey).toBe('2028-02-29');
	});

	it('reports the Dexie range as its own first and last cell', () => {
		const grid = monthGrid(2026, 8, 1, NOW);
		expect(grid.fromKey).toBe(grid.cells[0]?.dateKey);
		expect(grid.toKey).toBe(grid.cells[grid.cells.length - 1]?.dateKey);
		// Inclusive at both ends, and sorted — which is what makes a string
		// `between` over the index exact.
		expect(grid.fromKey < grid.toKey).toBe(true);
	});

	it('runs consecutive days with no gaps and no repeats', () => {
		const keys = monthGrid(2026, 3, 1, NOW).cells.map((c) => c.dateKey);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toEqual([...keys].sort());
	});
});

describe('monthGrid — today', () => {
	it('rings exactly one cell, and it is the right one', () => {
		const grid = monthGrid(2026, 8, 1, NOW);
		const today = grid.cells.filter((c) => c.isToday);
		expect(today.length).toBe(1);
		expect(today[0]?.dateKey).toBe('2026-08-28');
	});

	it('rings nothing in a month that is not the current one', () => {
		expect(monthGrid(2026, 9, 1, NOW).cells.some((c) => c.isToday)).toBe(false);
	});

	it('still rings today when it falls in a leading or trailing cell', () => {
		// 30 August 2026 is a Sunday, so it is the first leading cell of the
		// September grid. It is still today, and a ring the user can see move
		// off the month it belongs to is the point of drawing those days at all.
		const grid = monthGrid(2026, 9, 0, new Date(2026, 7, 30, 10, 0));
		const today = grid.cells.find((c) => c.isToday);
		expect(today?.dateKey).toBe('2026-08-30');
		expect(today?.inMonth).toBe(false);
	});
});

describe('monthGrid — the lunar overlay (doc 07 §6)', () => {
	it('gives every cell a lunar date, including the ones outside the month', () => {
		// A lunar month boundary lands on a leading day as readily as anywhere
		// else, and a grid that skipped them would drop a mùng 1 every so often.
		const grid = monthGrid(2026, 8, 1, NOW);
		expect(grid.cells.every((c) => c.lunar !== null)).toBe(true);
	});

	it('accents mùng 1 and rằm, and nothing else', () => {
		const grid = monthGrid(2026, 8, 1, NOW);
		for (const cell of grid.cells) {
			const expected = cell.lunar?.day === 1 ? 'mung-mot' : cell.lunar?.day === 15 ? 'ram' : null;
			expect(cell.accent, cell.dateKey).toBe(expected);
		}
		// And both actually occur in a month, or the assertion above is vacuous.
		expect(grid.cells.some((c) => c.accent === 'mung-mot')).toBe(true);
		expect(grid.cells.some((c) => c.accent === 'ram')).toBe(true);
	});

	it('puts Tết 2026 on lunar 1/1 in the February grid', () => {
		const cell = monthGrid(2026, 2, 1, NOW).cells.find((c) => c.dateKey === '2026-02-17');
		expect(cell?.lunar).toEqual({ day: 1, month: 1, year: 2026, leap: false });
		expect(cell?.accent).toBe('mung-mot');
	});

	it('leaves the lunar date null past the end of the supported range', () => {
		// January 2101, whose leading cells are still in 2100. The boundary is
		// per cell rather than per grid, which is the honest place for it: the
		// last days of 2100 have a lunar date and the first of 2101 do not.
		const grid = monthGrid(2101, 1, 1, NOW);
		expect(grid.cells.filter((c) => c.inMonth).every((c) => c.lunar === null)).toBe(true);
		expect(grid.cells.filter((c) => c.inMonth).every((c) => c.accent === null)).toBe(true);
		// The leading cells are still in 2100 and still have one; the trailing
		// ones are in February 2101 and do not.
		expect(grid.cells.filter((c) => c.date.y === 2100).every((c) => c.lunar !== null)).toBe(true);
		expect(grid.cells.some((c) => c.date.y === 2100)).toBe(true);
	});
});

describe('lunarMonthSpan', () => {
	it('names the lunar months a solar month actually spans', () => {
		// August 2026 runs from lunar month 6 into lunar month 7.
		const span = lunarMonthSpan(monthGrid(2026, 8, 1, NOW));
		expect(span.map((l) => l.month)).toEqual([6, 7]);
	});

	it('ignores the leading and trailing days', () => {
		// August 2027 is the clearest case: its own days run through lunar
		// months 6 and 7, while its trailing cells have already reached lunar
		// month 8. Counting those would make the header claim a third lunar
		// month the month itself never reaches.
		const grid = monthGrid(2027, 8, 1, NOW);
		const outside = grid.cells.filter((c) => !c.inMonth).map((c) => c.lunar?.month);
		expect(outside).toContain(8);
		expect(lunarMonthSpan(grid).map((l) => l.month)).toEqual([6, 7]);
	});

	it('never reports the same lunar month twice', () => {
		for (let month = 1; month <= 12; month++) {
			const span = lunarMonthSpan(monthGrid(2026, month, 1, NOW));
			const keys = span.map((l) => `${String(l.month)}${l.leap ? 'L' : ''}`);
			expect(new Set(keys).size, String(month)).toBe(keys.length);
		}
	});

	it('is empty outside the supported range rather than throwing', () => {
		expect(lunarMonthSpan(monthGrid(2101, 1, 1, NOW))).toEqual([]);
	});
});

describe('weekdayLabels', () => {
	it('gives the Vietnamese narrow forms a mini-grid has room for', () => {
		expect(weekdayLabels('vi', 1)).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
		expect(weekdayLabels('vi', 0)).toEqual(['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
	});

	it('rotates to the configured first day rather than reordering by hand', () => {
		expect(weekdayLabels('en', 1, 'short')[0]).toBe('Mon');
		expect(weekdayLabels('en', 0, 'short')[0]).toBe('Sun');
	});

	it('always returns seven', () => {
		for (const weekStartsOn of [0, 1]) {
			expect(weekdayLabels('vi', weekStartsOn)).toHaveLength(7);
			expect(weekdayLabels('en', weekStartsOn, 'short')).toHaveLength(7);
		}
	});
});

describe('countByDateKey', () => {
	it('counts events per day', () => {
		const counts = countByDateKey([
			event({ id: 'evt_a', dateKey: '2026-08-28' }),
			event({ id: 'evt_b', dateKey: '2026-08-28' }),
			event({ id: 'evt_c', dateKey: '2026-08-30' })
		]);
		expect(counts.get('2026-08-28')).toBe(2);
		expect(counts.get('2026-08-30')).toBe(1);
		expect(counts.get('2026-08-29')).toBeUndefined();
	});

	it('is empty for no events', () => {
		expect(countByDateKey([]).size).toBe(0);
	});
});

describe('sortEvents', () => {
	it('orders by title, so a new event does not land at random', () => {
		const rows = sortEvents([
			event({ id: 'evt_z', title: 'Họp nhóm' }),
			event({ id: 'evt_a', title: 'Bác sĩ' }),
			event({ id: 'evt_m', title: 'Cà phê' })
		]);
		expect(rows.map((r) => r.title)).toEqual(['Bác sĩ', 'Cà phê', 'Họp nhóm']);
	});

	it('sorts Vietnamese diacritics the way Vietnamese does', () => {
		// `localeCompare` with the locale, not a raw code-point sort: `Đ` sits
		// after `D` in Vietnamese and nowhere near it in UTF-16.
		const rows = sortEvents(
			[
				event({ id: 'evt_1', title: 'Em' }),
				event({ id: 'evt_2', title: 'Đi chợ' }),
				event({ id: 'evt_3', title: 'Ăn trưa' })
			],
			'vi'
		);
		expect(rows.map((r) => r.title)).toEqual(['Ăn trưa', 'Đi chợ', 'Em']);
	});

	it('breaks ties on the id so two identical titles do not swap places', () => {
		const rows = sortEvents([
			event({ id: 'evt_b', title: 'Giỗ' }),
			event({ id: 'evt_a', title: 'Giỗ' })
		]);
		expect(rows.map((r) => r.id)).toEqual(['evt_a', 'evt_b']);
	});

	it('does not mutate what it was given', () => {
		const input = [event({ id: 'evt_z', title: 'B' }), event({ id: 'evt_a', title: 'A' })];
		sortEvents(input);
		expect(input.map((r) => r.title)).toEqual(['B', 'A']);
	});
});
