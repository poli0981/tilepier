import { describe, expect, it } from 'vitest';
import { hourlyOption } from './chart';
import type { TpHourPoint } from './service';

/**
 * The 24 h option, asserted as data.
 *
 * The interesting parts of a chart option are exactly the parts a
 * rendered-canvas test cannot see: whether a gap breaks the line, whether the
 * bars have their own axis, and whether any colour got left in.
 */

const POINTS: TpHourPoint[] = [
	{ at: 1_000, tempC: 28, precipProb: 10 },
	{ at: 2_000, tempC: null, precipProb: null },
	{ at: 3_000, tempC: 31, precipProb: 40 }
];

/** Every string anywhere in the option. */
function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
	return [];
}

describe('hourlyOption', () => {
	it('carries no colour at all', () => {
		// The load-bearing one. ECharts merges a theme into the *defaults*, so a
		// colour left here would outrank `charts/theme.ts` forever — the theme
		// switch would run, log nothing, and change nothing.
		const colours = strings(hourlyOption(POINTS)).filter((s) => /^#|^rgb|^hsl/.test(s));
		expect(colours).toEqual([]);
	});

	it('keeps a gap as null rather than dropping the hour', () => {
		const option = hourlyOption(POINTS) as { series: { data: [number, number | null][] }[] };
		const line = option.series[0];

		expect(line?.data).toHaveLength(3);
		expect(line?.data[1]).toEqual([2_000, null]);
	});

	it('refuses to join the line across a gap', () => {
		// doc 10 §2: a missing hour is not a zero and it is not a straight line
		// between its neighbours either.
		const option = hourlyOption(POINTS) as { series: { connectNulls?: boolean }[] };
		expect(option.series[0]?.connectNulls).toBe(false);
	});

	it('gives the temperature the first series slot, and so the beacon', () => {
		// doc 12 §4.1: the accent marks *the* primary element. Series order is
		// what assigns the theme's colours, so this is the only place that
		// decision can be made — and getting it backwards is invisible to every
		// other assertion here.
		const option = hourlyOption(POINTS) as { series: { type: string }[] };
		expect(option.series[0]?.type).toBe('line');
		expect(option.series[1]?.type).toBe('bar');
	});

	it('puts the bars on their own axis, bounded 0–100', () => {
		// Precipitation chance is a percentage; sharing the temperature's axis
		// would squash one of them flat.
		const option = hourlyOption(POINTS) as {
			yAxis: { min?: number; max?: number; scale?: boolean }[];
			series: { yAxisIndex?: number }[];
		};

		expect(option.yAxis).toHaveLength(2);
		expect(option.yAxis[1]).toMatchObject({ min: 0, max: 100 });
		expect(option.series[0]?.yAxisIndex).toBe(0);
		expect(option.series[1]?.yAxisIndex).toBe(1);
	});

	it('lets the temperature axis follow the data instead of anchoring at zero', () => {
		// A day that runs 22–34° would otherwise spend two thirds of the chart on
		// degrees the forecast never reaches.
		const option = hourlyOption(POINTS) as { yAxis: { scale?: boolean }[] };
		expect(option.yAxis[0]?.scale).toBe(true);
	});

	it('draws the line above the bars', () => {
		const option = hourlyOption(POINTS) as { series: { z?: number }[] };
		expect(option.series[0]?.z).toBeGreaterThan(option.series[1]?.z ?? 0);
	});

	it('is a time axis, labelled by hour rather than by date', () => {
		const option = hourlyOption(POINTS) as {
			xAxis: { type?: string; axisLabel?: { formatter?: string } };
		};
		expect(option.xAxis.type).toBe('time');
		expect(option.xAxis.axisLabel?.formatter).toContain('HH');
	});

	it('survives an empty window', () => {
		const option = hourlyOption([]) as { series: { data: unknown[] }[] };
		expect(option.series[0]?.data).toEqual([]);
		expect(option.series[1]?.data).toEqual([]);
	});
});
