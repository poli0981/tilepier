import { describe, expect, it } from 'vitest';
import {
	convertLunar2Solar,
	convertSolar2Lunar,
	isSupportedYear,
	julianDayOf,
	lunarOf,
	lunarOfDate,
	solarOfLunar,
	SUPPORTED_RANGE,
	type TpLunarDate
} from './amlich';
import { canChiYear } from './format';
import vectors from './__fixtures__/amlich-vectors.json';

/**
 * doc 19 §3.1, carried over with the module from QuoteAtlas.
 *
 * The `pairs` in the fixture were produced BY this algorithm, so on their own
 * they pin behaviour rather than establish it. Three things carry the actual
 * weight, and they are why this suite is worth its runtime:
 *
 * 1. **An independent implementation.** Every day in 1900–2100 is compared
 *    against `Intl`'s `chinese` calendar — a different codebase reaching the
 *    same astronomy, one hour east. Where they agree both are almost certainly
 *    right; where they differ it must be a difference the fixture records and a
 *    human has looked at.
 * 2. **Invariants no wrong-but-consistent answer can satisfy.** Every lunar day
 *    is 1..30, every complete lunar month is 29 or 30 days, every day
 *    round-trips.
 * 3. **A short list a person read.** Everything above narrows the judgement
 *    call to six substantive divergence runs and the Tết column.
 */

const DAY = 86_400_000;
const FROM = Date.UTC(vectors.range.from, 0, 1);
const TO = Date.UTC(vectors.range.to, 11, 31);

interface Civil {
	d: number;
	m: number;
	y: number;
}

function eachDay(fn: (c: Civil, l: TpLunarDate, t: number) => void): number {
	let n = 0;
	for (let t = FROM; t <= TO; t += DAY) {
		const dt = new Date(t);
		const c = { d: dt.getUTCDate(), m: dt.getUTCMonth() + 1, y: dt.getUTCFullYear() };
		fn(c, convertSolar2Lunar(c.d, c.m, c.y), t);
		n++;
	}
	return n;
}

const iso = (c: Civil): string =>
	`${String(c.y)}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
const label = (l: TpLunarDate): string =>
	`${String(l.day)}/${String(l.month)}${l.leap ? 'L' : ''}/${String(l.year)}`;

describe('amlich — exhaustive invariants over every day 1900–2100', () => {
	it('produces only real lunar dates, and every day round-trips', () => {
		// Not a random sample: the two day-0 bugs below occupied 2 days out of
		// 73 414, which a 5000-draw property test misses most of the time.
		const badDates: string[] = [];
		const badMonths: string[] = [];
		const badTrips: string[] = [];

		const checked = eachDay((c, l) => {
			if (l.day < 1 || l.day > 30) badDates.push(`${iso(c)} → day ${String(l.day)}`);
			if (l.month < 1 || l.month > 12) badMonths.push(`${iso(c)} → month ${String(l.month)}`);
			const back = convertLunar2Solar(l.day, l.month, l.year, l.leap);
			if (back.d !== c.d || back.m !== c.m || back.y !== c.y) badTrips.push(iso(c));
		});

		expect(checked).toBe(vectors.crossCheck.comparedDays);
		expect(badDates).toEqual([]);
		expect(badMonths).toEqual([]);
		expect(badTrips).toEqual([]);
	});

	it('gives every complete lunar month 29 or 30 days', () => {
		// A month of any other length means a new-moon boundary landed wrong —
		// the same class of fault as a day-0, caught from the other direction.
		const lengths = new Map<string, number>();
		eachDay((_c, l) => {
			const key = label({ ...l, day: 1 });
			lengths.set(key, (lengths.get(key) ?? 0) + 1);
		});
		const keys = [...lengths.keys()];
		// The first and last months in range are truncated by the window itself.
		const wrong = keys.slice(1, -1).filter((k) => {
			const n = lengths.get(k);
			return n !== 29 && n !== 30;
		});
		expect(wrong).toEqual([]);
		expect(keys.length).toBeGreaterThan(2400);
	});
});

describe('amlich — day-0 regression', () => {
	// The mean-synodic estimate of `k` can be off by one in either direction,
	// but the algorithm as usually published steps down only once. These two
	// dates fell through and reported lunar day 0 — a date that cannot exist and
	// would have rendered as "ngày 0 tháng 4".
	//
	// The round-trip property could not catch it: convertLunar2Solar(0, 4, 2054)
	// maps straight back to 2054-05-07, so the pair is self-consistent nonsense.
	for (const [d, m, y, day, month] of [
		[7, 5, 2054, 30, 3],
		[9, 4, 2062, 30, 2]
	] as const) {
		it(`${String(d)}/${String(m)}/${String(y)} is day ${String(day)} of month ${String(month)}, not day 0`, () => {
			const l = convertSolar2Lunar(d, m, y);
			expect(l.day).toBe(day);
			expect(l.month).toBe(month);
		});
	}

	it('keeps the days either side of that boundary consecutive', () => {
		expect(convertSolar2Lunar(6, 5, 2054).day).toBe(29);
		expect(convertSolar2Lunar(7, 5, 2054).day).toBe(30);
		expect(convertSolar2Lunar(8, 5, 2054)).toMatchObject({ day: 1, month: 4 });
	});
});

describe('amlich — independent cross-check against the UTC+8 calendar', () => {
	it('differs from it only where the fixture says it may', () => {
		const fmt = new Intl.DateTimeFormat('en-u-ca-chinese', {
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			timeZone: 'UTC'
		});

		let disagreements = 0;
		const runs: { from: string; to: string; days: number }[] = [];
		let lastT = 0;

		eachDay((c, l, t) => {
			const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
			const raw = p.month ?? '';
			const cn = {
				day: Number(p.day),
				month: Number.parseInt(raw, 10),
				leap: raw.includes('bis'),
				year: Number(p.relatedYear)
			};
			if (l.day === cn.day && l.month === cn.month && l.leap === cn.leap && l.year === cn.year) {
				return;
			}
			disagreements++;
			const last = runs[runs.length - 1];
			if (last !== undefined && t - lastT === DAY) {
				last.to = iso(c);
				last.days += 1;
			} else {
				runs.push({ from: iso(c), to: iso(c), days: 1 });
			}
			lastT = t;
		});

		expect(disagreements).toBe(vectors.crossCheck.disagreementDays);
		expect(runs.length).toBe(vectors.crossCheck.runs);

		// Every substantive (leap-placement) divergence is still exactly where
		// the reviewed fixture says it is — start, end and length.
		const found = new Set(runs.map((r) => `${r.from}..${r.to}/${String(r.days)}`));
		for (const r of vectors.divergence.substantive) {
			const key = `${r.from}..${r.to}/${String(r.days)}`;
			expect(found.has(key), `divergence run ${key} moved`).toBe(true);
		}
	});
});

describe('amlich — Tết (every lunar new year 1900–2100)', () => {
	it('covers the whole range with one Tết per year', () => {
		expect(vectors.tet.length).toBe(vectors.range.to - vectors.range.from + 1);
	});

	it('places every Tết on lunar 1/1 and round-trips it', () => {
		for (const t of vectors.tet) {
			const [y, m, d] = t.solar.split('-').map(Number) as [number, number, number];
			const l = convertSolar2Lunar(d, m, y);
			expect(l, `Tết ${t.solar}`).toMatchObject({ day: 1, month: 1, leap: false });
			expect(canChiYear(l.year), `can-chi for ${t.solar}`).toBe(t.canChi);
			expect(convertLunar2Solar(1, 1, l.year, false)).toEqual({ d, m, y });
		}
	});

	it('agrees with the Tết dates a Vietnamese reader can check by hand', () => {
		// Anchors a person can confirm without any of the generated data.
		const known = [
			'2020-01-25',
			'2021-02-12',
			'2022-02-01',
			'2023-01-22',
			'2024-02-10',
			'2025-01-29',
			'2026-02-17',
			'2027-02-06',
			'2028-01-26',
			// The divergence this module exists for: the UTC+8 calendar puts
			// this new year on 18/2.
			'2007-02-17',
			// Tết Mậu Thân — VN and CN differ by a day here too.
			'1968-01-29'
		];
		for (const solar of known) {
			expect(
				vectors.tet.some((t) => t.solar === solar),
				`Tết ${solar}`
			).toBe(true);
		}
	});
});

describe('amlich — leap months', () => {
	it('starts each recorded leap month on lunar day 1 of that month', () => {
		for (const lm of vectors.leapMonths) {
			const [y, m, d] = lm.startsOn.split('-').map(Number) as [number, number, number];
			expect(convertSolar2Lunar(d, m, y), `leap ${lm.startsOn}`).toEqual({
				day: 1,
				month: lm.month,
				year: lm.year,
				leap: true
			});
		}
	});

	it('never gives a lunar year two leap months', () => {
		const perYear = new Map<number, number>();
		for (const lm of vectors.leapMonths) perYear.set(lm.year, (perYear.get(lm.year) ?? 0) + 1);
		expect([...perYear.values()].filter((n) => n > 1)).toEqual([]);
	});

	it('refuses a leap month that does not exist that year', () => {
		// 2023's leap month is 2; a leap 5 is not a date.
		expect(solarOfLunar({ day: 1, month: 5, year: 2023, leap: true })).toBeNull();
	});
});

describe('amlich — frozen pairs', () => {
	it('still maps every recorded solar date to the same lunar date', () => {
		expect(vectors.pairs.length).toBeGreaterThanOrEqual(400);
		for (const p of vectors.pairs) {
			const [solar, lunar] = p.split('=') as [string, string];
			const [y, m, d] = solar.split('-').map(Number) as [number, number, number];
			expect(label(convertSolar2Lunar(d, m, y)), solar).toBe(lunar);
		}
	});
});

describe('amlich — the conversion is pinned to UTC+7 (doc 07 §6, doc 19 §3.1)', () => {
	it('takes a calendar date, not an instant, so no clock can influence it', () => {
		// The pin is structural rather than defensive: `lunarOfDate` has no way
		// to read a zone, because it is never given one. This is the assertion
		// doc 19 §3.1 asks for — a viewer in UTC-8 and one in UTC+7 looking at
		// the same date get the same lunar day — stated as the property that
		// makes it true, since `TZ` cannot be changed inside a running process.
		expect(lunarOfDate({ d: 17, m: 2, y: 2026 })).toEqual({
			day: 1,
			month: 1,
			year: 2026,
			leap: false
		});
		expect(lunarOfDate({ d: 17, m: 2, y: 2026 })).toEqual(convertSolar2Lunar(17, 2, 2026, 7));
	});

	it('is pinned to +7 specifically, and the pin changes answers', () => {
		// If +7 and +8 agreed everywhere, the pin would be decoration. They do
		// not: Tết 2007 is 17 February in Vietnam and 18 February at UTC+8, and
		// that single day is the reason this module exists rather than `Intl`.
		expect(convertSolar2Lunar(17, 2, 2007, 7)).toMatchObject({ day: 1, month: 1 });
		expect(convertSolar2Lunar(17, 2, 2007, 8)).not.toMatchObject({ day: 1, month: 1 });
		expect(lunarOfDate({ d: 17, m: 2, y: 2007 })).toEqual(convertSolar2Lunar(17, 2, 2007, 7));
	});

	it('reads the viewer own calendar date from an instant', () => {
		// Which date you are on is local; what lunar date that is, is pinned.
		// Built from a local Date so the assertion holds on a runner in any zone.
		const at = new Date(2026, 7, 28, 10, 0);
		expect(lunarOf(at)).toEqual(lunarOfDate({ d: 28, m: 8, y: 2026 }));
	});

	it('accepts a Date as readily as a timestamp', () => {
		const at = new Date(2026, 7, 28, 10, 0);
		expect(lunarOf(at.getTime())).toEqual(lunarOf(at));
	});
});

describe('amlich — supported range (doc 07 §6)', () => {
	it('spans 1900 to 2100, which is what the vectors cover', () => {
		expect(SUPPORTED_RANGE).toEqual({ from: vectors.range.from, to: vectors.range.to });
	});

	it('accepts the endpoints and refuses what lies outside', () => {
		expect(isSupportedYear(1900)).toBe(true);
		expect(isSupportedYear(2100)).toBe(true);
		expect(isSupportedYear(1899)).toBe(false);
		expect(isSupportedYear(2101)).toBe(false);
		expect(isSupportedYear(2026.5)).toBe(false);
		expect(isSupportedYear(Number.NaN)).toBe(false);
	});

	it('returns null rather than an answer nothing vouches for', () => {
		expect(lunarOfDate({ d: 1, m: 1, y: 1899 })).toBeNull();
		expect(lunarOfDate({ d: 1, m: 1, y: 2101 })).toBeNull();
		expect(solarOfLunar({ day: 1, month: 1, year: 1850, leap: false })).toBeNull();
	});

	it('still answers inside the range', () => {
		expect(lunarOfDate({ d: 17, m: 2, y: 2026 })).toEqual({
			day: 1,
			month: 1,
			year: 2026,
			leap: false
		});
		expect(solarOfLunar({ day: 1, month: 1, year: 2026, leap: false })).toEqual({
			d: 17,
			m: 2,
			y: 2026
		});
	});
});

describe('amlich — julianDayOf', () => {
	it('agrees with the J2000 epoch a reader can look up', () => {
		// JD 2451545.0 is 2000-01-01 12:00 TT; the day number is 2451545.
		expect(julianDayOf({ d: 1, m: 1, y: 2000 })).toBe(2_451_545);
	});

	it('advances by exactly one per civil day, across a month boundary', () => {
		expect(julianDayOf({ d: 1, m: 3, y: 2026 }) - julianDayOf({ d: 28, m: 2, y: 2026 })).toBe(1);
		// And by two across the same boundary in a leap year, with the 29th in
		// between — the arithmetic is calendar-aware, not a 30-day assumption.
		expect(julianDayOf({ d: 1, m: 3, y: 2028 }) - julianDayOf({ d: 28, m: 2, y: 2028 })).toBe(2);
	});
});

describe('amlich — historical & edge branches', () => {
	it('handles pre-Gregorian (Julian, < 1582) dates without throwing', () => {
		// The public API guards these; the maths underneath still has to be
		// total, because the Julian branch sits on the path for any date at all.
		const l = convertSolar2Lunar(1, 1, 1500);
		expect(l.month).toBeGreaterThanOrEqual(1);
		expect(l.month).toBeLessThanOrEqual(12);
		const s = convertLunar2Solar(l.day, l.month, l.year, l.leap);
		expect(s.y).toBeGreaterThan(0);
	});

	it('handles ancient dates using the old ΔT formula', () => {
		const l = convertSolar2Lunar(1, 1, 700); // t < -11 → ancient-date ΔT branch
		expect(l.day).toBeGreaterThanOrEqual(1);
		expect(l.day).toBeLessThanOrEqual(30);
	});
});
