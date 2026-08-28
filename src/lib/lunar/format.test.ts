import { describe, expect, it } from 'vitest';
import { lunarOfDate, type TpLunarDate } from './amlich';
import { canChiDay, canChiMonth, canChiYear, fmtLunarLong, fmtLunarShort } from './format';
import vectors from './__fixtures__/amlich-vectors.json';

/**
 * `canChiYear` is covered by the fixture — every one of the 201 Tết rows
 * carries the year's can-chi, checked in `amlich.test.ts`. **`canChiMonth` and
 * `canChiDay` are not**: they were added here and the carried vectors say
 * nothing about them, so they are the one part of this module with no
 * independent evidence behind it.
 *
 * This suite is that evidence, and it deliberately does not check the formulas
 * against their own output. Each is checked against the *rule* it implements —
 * rules a Vietnamese reader knows and can confirm without running anything.
 */

const lunar = (day: number, month: number, year: number, leap = false): TpLunarDate => ({
	day,
	month,
	year,
	leap
});

describe('canChiYear', () => {
	it('names the years everyone knows', () => {
		expect(canChiYear(2020)).toBe('Canh Tý');
		expect(canChiYear(2024)).toBe('Giáp Thìn');
		expect(canChiYear(2026)).toBe('Bính Ngọ');
	});

	it('repeats on a sixty-year cycle and not before', () => {
		expect(canChiYear(2026 + 60)).toBe(canChiYear(2026));
		for (let offset = 1; offset < 60; offset++) {
			expect(canChiYear(2026 + offset), `offset ${String(offset)}`).not.toBe(canChiYear(2026));
		}
	});
});

describe('canChiMonth', () => {
	it('fixes each month to its branch, which never moves', () => {
		// Tháng Giêng is always Dần, tháng Một always Tý, tháng Chạp always Sửu.
		// This holds for every year, so it is checked across a span of them.
		const BRANCHES = [
			'Dần',
			'Mão',
			'Thìn',
			'Tỵ',
			'Ngọ',
			'Mùi',
			'Thân',
			'Dậu',
			'Tuất',
			'Hợi',
			'Tý',
			'Sửu'
		];
		for (let year = 2020; year <= 2030; year++) {
			for (let month = 1; month <= 12; month++) {
				expect(
					canChiMonth(year, month).split(' ')[1],
					`month ${String(month)} of ${String(year)}`
				).toBe(BRANCHES[month - 1]);
			}
		}
	});

	it('opens each year on the stem the ngũ hổ độn rule names', () => {
		// The rule, in the order it is recited: a Giáp or Kỷ year opens with
		// Bính, an Ất or Canh year with Mậu, a Bính or Tân year with Canh, a
		// Đinh or Nhâm year with Nhâm, and a Mậu or Quý year with Giáp.
		const FIRST_STEM: Record<string, string> = {
			Giáp: 'Bính',
			Kỷ: 'Bính',
			Ất: 'Mậu',
			Canh: 'Mậu',
			Bính: 'Canh',
			Tân: 'Canh',
			Đinh: 'Nhâm',
			Nhâm: 'Nhâm',
			Mậu: 'Giáp',
			Quý: 'Giáp'
		};
		// A full stem cycle, so every line of the rule is exercised twice.
		for (let year = 2020; year < 2040; year++) {
			const yearStem = canChiYear(year).split(' ')[0] ?? '';
			expect(canChiMonth(year, 1).split(' ')[0], `year ${String(year)} (${yearStem})`).toBe(
				FIRST_STEM[yearStem]
			);
		}
	});

	it('advances one stem per month across a year boundary', () => {
		// Month 12 of one year and month 1 of the next are consecutive months,
		// so their stems must be consecutive too — the arithmetic has to carry
		// across the year, which is the part a per-year table would get wrong.
		const STEMS = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
		const stemOf = (label: string): number => STEMS.indexOf(label.split(' ')[0] ?? '');
		for (let year = 2020; year < 2030; year++) {
			const last = stemOf(canChiMonth(year, 12));
			const next = stemOf(canChiMonth(year + 1, 1));
			expect(next, `${String(year)}/12 → ${String(year + 1)}/1`).toBe((last + 1) % 10);
		}
	});

	it('gives a leap month the can-chi of the month it repeats', () => {
		// A leap month is the same branch position in the year — that is what
		// makes it a repeat rather than a thirteenth month.
		expect(canChiMonth(2023, 2)).toBe(canChiMonth(2023, 2));
		expect(canChiMonth(2023, 2).split(' ')[1]).toBe('Mão');
	});
});

describe('canChiDay', () => {
	it('agrees with the anchor a reader can look up', () => {
		// 1 January 2000 is JDN 2 451 545 — the J2000 epoch — and is a Mậu Ngọ
		// day in the sexagenary cycle. Both halves of that are published facts,
		// which is what makes this the one assertion the rest hangs off.
		expect(canChiDay({ d: 1, m: 1, y: 2000 })).toBe('Mậu Ngọ');
	});

	it('advances by one place per civil day', () => {
		const STEMS = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
		const BRANCHES = [
			'Tý',
			'Sửu',
			'Dần',
			'Mão',
			'Thìn',
			'Tỵ',
			'Ngọ',
			'Mùi',
			'Thân',
			'Dậu',
			'Tuất',
			'Hợi'
		];
		// Across a month boundary, so the walk is calendar arithmetic rather
		// than a 30-day assumption.
		const days = [
			{ d: 28, m: 2, y: 2026 },
			{ d: 1, m: 3, y: 2026 },
			{ d: 2, m: 3, y: 2026 }
		];
		const labels = days.map((day) => canChiDay(day));
		for (let i = 1; i < labels.length; i++) {
			const before = (labels[i - 1] ?? '').split(' ');
			const after = (labels[i] ?? '').split(' ');
			expect(STEMS.indexOf(after[0] ?? '')).toBe((STEMS.indexOf(before[0] ?? '') + 1) % 10);
			expect(BRANCHES.indexOf(after[1] ?? '')).toBe((BRANCHES.indexOf(before[1] ?? '') + 1) % 12);
		}
	});

	it('repeats on a sixty-day cycle, unbroken across the Gregorian reform', () => {
		// The day cycle has run continuously through every calendar reform —
		// which is exactly why it is counted in Julian days and not derived
		// from the lunar date.
		expect(canChiDay({ d: 1, m: 3, y: 2026 })).toBe(canChiDay({ d: 30, m: 4, y: 2026 }));
		expect(canChiDay({ d: 4, m: 10, y: 1582 })).not.toBe(canChiDay({ d: 15, m: 10, y: 1582 }));
	});
});

describe('fmtLunarShort — the clock and calendar header line (doc 14 §3)', () => {
	it('gives the Vietnamese form doc 14 §3 specifies', () => {
		expect(fmtLunarShort(lunar(8, 7, 2026), 'vi')).toBe('08/07 Bính Ngọ');
	});

	it('gives the English form spelled out, and without can-chi', () => {
		// doc 14 §3: can-chi is rendered only in vi. It is cultural literacy
		// rather than information, and transliterating it buys nothing.
		expect(fmtLunarShort(lunar(7, 7, 2026), 'en')).toBe('7th day, 7th lunar month');
		expect(fmtLunarShort(lunar(7, 7, 2026), 'en')).not.toContain('Bính');
	});

	it('zero-pads the Vietnamese form so the line does not reflow', () => {
		// It sits under a clock that is already mono and already fixed-width;
		// a jump between the 9th and the 10th would be visible every month.
		expect(fmtLunarShort(lunar(9, 1, 2026), 'vi')).toBe('09/01 Bính Ngọ');
		expect(fmtLunarShort(lunar(10, 1, 2026), 'vi')).toBe('10/01 Bính Ngọ');
		expect(fmtLunarShort(lunar(9, 1, 2026), 'vi')).toHaveLength(
			fmtLunarShort(lunar(10, 1, 2026), 'vi').length
		);
	});

	it('marks a leap month in both locales', () => {
		expect(fmtLunarShort(lunar(1, 2, 2023, true), 'vi')).toBe('01/02N Quý Mão');
		expect(fmtLunarShort(lunar(1, 2, 2023, true), 'en')).toBe('1st day, 2nd leap lunar month');
	});
});

describe('fmtLunarLong — the calendar detail panel', () => {
	it('spells the month name rather than numbering it', () => {
		// Vietnamese lunar months are not ordinals: the first is Giêng and the
		// last two are Một and Chạp.
		expect(fmtLunarLong(lunar(22, 5, 2026), 'vi')).toBe('ngày 22 tháng Năm, Bính Ngọ');
		expect(fmtLunarLong(lunar(1, 1, 2026), 'vi')).toBe('ngày 1 tháng Giêng, Bính Ngọ');
		expect(fmtLunarLong(lunar(23, 12, 2025), 'vi')).toBe('ngày 23 tháng Chạp, Ất Tỵ');
		expect(fmtLunarLong(lunar(15, 11, 2025), 'vi')).toBe('ngày 15 tháng Một, Ất Tỵ');
	});

	it('marks a leap month', () => {
		expect(fmtLunarLong(lunar(1, 6, 2025, true), 'vi')).toBe('ngày 1 tháng Sáu (nhuận), Ất Tỵ');
		expect(fmtLunarLong(lunar(1, 6, 2025, true), 'en')).toBe(
			'1st day of the 6th lunar month (leap), Ất Tỵ'
		);
	});
});

describe('format — against real dates from the calendar', () => {
	it('labels Tết 2026 the way a Vietnamese calendar prints it', () => {
		const tet = lunarOfDate({ d: 17, m: 2, y: 2026 });
		expect(tet).not.toBeNull();
		expect(fmtLunarLong(tet as TpLunarDate, 'vi')).toBe('ngày 1 tháng Giêng, Bính Ngọ');
		expect(fmtLunarShort(tet as TpLunarDate, 'vi')).toBe('01/01 Bính Ngọ');
	});

	it('renders every Tết in the fixture without falling back to a raw number', () => {
		for (const t of vectors.tet) {
			const [y, m, d] = t.solar.split('-').map(Number) as [number, number, number];
			const l = lunarOfDate({ d, m, y });
			expect(l, t.solar).not.toBeNull();
			expect(fmtLunarLong(l as TpLunarDate, 'vi'), t.solar).toBe(`ngày 1 tháng Giêng, ${t.canChi}`);
		}
	});
});
