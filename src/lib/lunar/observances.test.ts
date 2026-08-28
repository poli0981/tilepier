import { describe, expect, it } from 'vitest';
import { lunarOfDate } from './amlich';
import { OBSERVANCES, upcomingObservances } from './observances';
import vectors from './__fixtures__/amlich-vectors.json';

/**
 * doc 07 §6's observance table. The lunar dates themselves are definitional —
 * Trung thu *is* 15/8 — so what is worth testing is that the solar dates come
 * out where a Vietnamese reader expects them, and that the "next five" walk
 * behaves at the two places it could plausibly break: the turn of the lunar
 * year, and the far end of the supported range.
 */

describe('the table', () => {
	it('carries the observances doc 07 §6 names', () => {
		const ids = OBSERVANCES.map((o) => o.id);
		expect(ids).toContain('tet');
		expect(ids).toContain('hung-vuong');
		expect(ids).toContain('nguyen-tieu');
		expect(ids).toContain('vu-lan');
		expect(ids).toContain('trung-thu');
	});

	it('lists them in lunar-year order, which is the order they are lived in', () => {
		const keys = OBSERVANCES.map((o) => o.month * 100 + o.day);
		expect(keys).toEqual([...keys].sort((a, b) => a - b));
	});

	it('puts every entry on a real lunar day of a real lunar month', () => {
		for (const o of OBSERVANCES) {
			expect(o.month, o.id).toBeGreaterThanOrEqual(1);
			expect(o.month, o.id).toBeLessThanOrEqual(12);
			expect(o.day, o.id).toBeGreaterThanOrEqual(1);
			// Never 30: a lunar month can be 29 days, and an observance pinned to
			// the 30th would simply not exist in half of them.
			expect(o.day, o.id).toBeLessThanOrEqual(29);
		}
	});
});

describe('upcomingObservances', () => {
	it('lands Tết 2026 on the day the fixture and every calendar agree on', () => {
		const next = upcomingObservances({ d: 1, m: 1, y: 2026 }, 8);
		const tet = next.find((o) => o.id === 'tet');
		expect(tet?.solar).toEqual({ d: 17, m: 2, y: 2026 });
		// Cross-checked against the vector set's own Tết column, which is the
		// human-verified list.
		expect(vectors.tet.some((t) => t.solar === '2026-02-17')).toBe(true);
	});

	it('lands Trung thu and Giỗ tổ Hùng Vương 2026 where they are observed', () => {
		const next = upcomingObservances({ d: 1, m: 1, y: 2026 }, 8);
		// 15/8 lunar and 10/3 lunar in the year Bính Ngọ.
		expect(next.find((o) => o.id === 'trung-thu')?.solar).toEqual({ d: 25, m: 9, y: 2026 });
		expect(next.find((o) => o.id === 'hung-vuong')?.solar).toEqual({ d: 26, m: 4, y: 2026 });
	});

	it('returns them soonest first', () => {
		const next = upcomingObservances({ d: 1, m: 1, y: 2026 }, 8);
		const ordinals = next.map((o) => o.solar.y * 10_000 + o.solar.m * 100 + o.solar.d);
		expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b));
	});

	it('includes an observance falling today, not only ones after it', () => {
		// A list of what is coming that drops today at breakfast would be wrong
		// on the one day each of these matters most.
		const next = upcomingObservances({ d: 17, m: 2, y: 2026 }, 1);
		expect(next[0]?.id).toBe('tet');
		expect(next[0]?.solar).toEqual({ d: 17, m: 2, y: 2026 });
	});

	it('crosses into the next lunar year rather than running empty', () => {
		// Late December: every entry in the table has already passed for this
		// lunar year. Searching one year would return nothing until Tết.
		const next = upcomingObservances({ d: 28, m: 12, y: 2026 }, 5);
		expect(next.length).toBe(5);
		expect(next[0]?.id).toBe('ong-tao');
		expect(next.some((o) => o.id === 'tet')).toBe(true);
	});

	it('always finds a full list anywhere inside the supported range', () => {
		// Sampled across two centuries rather than at one date, because the
		// two-lunar-year window is the kind of thing that works for the year it
		// was written in.
		for (let year = 1901; year <= 2099; year += 7) {
			for (const m of [1, 6, 12]) {
				const next = upcomingObservances({ d: 15, m, y: year }, 5);
				expect(next.length, `${String(year)}-${String(m)}`).toBe(5);
			}
		}
	});

	it('gives every result a lunar date matching its solar one', () => {
		for (const o of upcomingObservances({ d: 1, m: 1, y: 2026 }, 8)) {
			expect(lunarOfDate(o.solar), o.id).toEqual(o.lunar);
		}
	});

	it('says nothing rather than guessing outside the supported range', () => {
		expect(upcomingObservances({ d: 1, m: 1, y: 1899 })).toEqual([]);
		expect(upcomingObservances({ d: 1, m: 1, y: 2101 })).toEqual([]);
	});

	it('degrades to a short list at the very end of the range', () => {
		// 2101 is unsupported, so the second lunar year contributes nothing and
		// the list runs short rather than throwing or wrapping to 1900.
		const next = upcomingObservances({ d: 1, m: 12, y: 2100 }, 5);
		expect(next.length).toBeLessThan(5);
		for (const o of next) expect(o.solar.y).toBeLessThanOrEqual(2100);
	});
});
