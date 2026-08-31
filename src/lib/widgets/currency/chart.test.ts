import { describe, expect, it } from 'vitest';
import { historyOption } from './chart';
import type { TpHistoryPoint } from './service';

/**
 * The history option, asserted as data — the parts a rendered-canvas test
 * cannot see are exactly the interesting ones.
 */

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-08-29T00:00:00Z');

const POINTS: TpHistoryPoint[] = [
	{ at: T0, rate: 25_900 },
	{ at: T0 + DAY, rate: null },
	{ at: T0 + 2 * DAY, rate: 26_006 }
];

/** Every string anywhere in the option. */
function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
	return [];
}

describe('historyOption', () => {
	it('carries no colour at all', () => {
		// The load-bearing one, and the same assertion weather's chart carries.
		// ECharts merges a theme into the *defaults*, so a colour left here would
		// outrank `charts/theme.ts` forever: the theme switch would run, log
		// nothing, and change nothing.
		const colours = strings(historyOption(POINTS)).filter((s) => /^#|^rgb|^hsl/.test(s));
		expect(colours).toEqual([]);
	});

	it('plots against time, never an index', () => {
		// doc 10 §3: a day upstream published nothing is a legal gap. An index
		// axis would close it up and draw three days of movement in the space of
		// one, saying nothing about the silence between them.
		const option = historyOption(POINTS) as { xAxis: { type: string } };
		expect(option.xAxis.type).toBe('time');
	});

	it('keeps a silent day as null rather than dropping it', () => {
		const option = historyOption(POINTS) as { series: { data: [number, number | null][] }[] };
		expect(option.series[0]?.data).toHaveLength(3);
		expect(option.series[0]?.data[1]).toEqual([T0 + DAY, null]);
	});

	it('refuses to join the line across that day', () => {
		const option = historyOption(POINTS) as { series: { connectNulls?: boolean }[] };
		expect(option.series[0]?.connectNulls).toBe(false);
	});

	it('does not smooth, because a daily fix is not a continuous quantity', () => {
		// Deliberately unlike weather's temperature line. There was no rate between
		// Monday's and Tuesday's, and a curve between them would invent one —
		// complete with overshoot past both endpoints.
		const option = historyOption(POINTS) as { series: { smooth?: boolean }[] };
		expect(option.series[0]?.smooth).toBe(false);
	});

	it('lets the axis follow the data rather than anchoring at zero', () => {
		// A rate never approaches zero, so a zero-anchored axis flattens a 2 %
		// move into a straight line.
		const option = historyOption(POINTS) as { yAxis: { scale?: boolean } };
		expect(option.yAxis.scale).toBe(true);
	});

	it('draws an empty window without throwing', () => {
		const option = historyOption([]) as { series: { data: unknown[] }[] };
		expect(option.series[0]?.data).toEqual([]);
	});
});
