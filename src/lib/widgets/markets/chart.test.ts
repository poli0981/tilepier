import { describe, expect, it } from 'vitest';
import type { TpCryptoCandle } from '$lib/api-types';
import { candleSummary, candlestickOption } from './chart';

/**
 * doc 09 §1's candlestick option.
 *
 * The case that matters most is the field order: ECharts wants
 * `[open, close, low, high]` where doc 10 §4's tuple is
 * `[t, open, high, low, close]`, and getting it wrong produces a chart that
 * still reads as a market — every body inverted, every wick upside down — which
 * is the kind of wrong nobody notices from a screenshot.
 */

/** `[openTime, open, high, low, close, volume]`. */
const CANDLES: TpCryptoCandle[] = [
	[1_788_000_000_000, 100, 110, 95, 105, 12],
	[1_788_000_300_000, 105, 120, 104, 118, 30],
	[1_788_000_600_000, 118, 119, 90, 92, 51]
];

const OPTIONS = { formatPrice: (v: number) => v.toFixed(2), volumeLabel: 'volume' };

interface SeriesShape {
	type: string;
	data: unknown[];
	xAxisIndex?: number;
	yAxisIndex?: number;
}

function seriesOf(option: ReturnType<typeof candlestickOption>): SeriesShape[] {
	return option.series as unknown as SeriesShape[];
}

describe('candlestickOption', () => {
	it('reorders each candle into open, close, low, high', () => {
		const [candles] = seriesOf(candlestickOption(CANDLES, OPTIONS));

		// Source row is [t, 100, 110, 95, 105] — open 100, high 110, low 95,
		// close 105 — and ECharts wants [t, open, close, low, high].
		expect(candles?.data[0]).toEqual([1_788_000_000_000, 100, 105, 95, 110]);
	});

	it('carries no colour of its own, so the theme can own every one', () => {
		// `setTheme` merges into the chart's *defaults*, and an explicit option
		// value outranks it forever — a colour written here could never follow a
		// theme switch. The candle colours live in `charts/theme.ts`.
		const json = JSON.stringify(candlestickOption(CANDLES, OPTIONS));

		expect(json).not.toMatch(/#[0-9a-f]{3,8}/i);
		expect(json).not.toContain('rgb');
	});

	it('puts the volume on its own grid and axis, under the candles', () => {
		const option = candlestickOption(CANDLES, OPTIONS);
		const [, volume] = seriesOf(option);

		expect(volume?.type).toBe('bar');
		expect(volume?.xAxisIndex).toBe(1);
		expect(volume?.yAxisIndex).toBe(1);
		expect(option.grid).toHaveLength(2);
	});

	it('binds the zoom to both axes, or scrubbing leaves the volume behind', () => {
		const zooms = candlestickOption(CANDLES, OPTIONS).dataZoom as { xAxisIndex: number[] }[];

		expect(zooms).toHaveLength(2);
		for (const zoom of zooms) expect(zoom.xAxisIndex).toEqual([0, 1]);
	});

	it('plots against time rather than a category, so a gap stays a gap', () => {
		const axes = candlestickOption(CANDLES, OPTIONS).xAxis as { type: string }[];

		// A category axis closes a missing hour up and draws a market that never
		// stopped trading. `normalizeCryptoKlines` drops unreadable rows rather
		// than zero-filling them, which is what makes the gap reachable at all.
		expect(axes.map((a) => a.type)).toEqual(['time', 'time']);
	});

	it('survives an empty series without inventing an axis', () => {
		const option = candlestickOption([], OPTIONS);

		expect(seriesOf(option)[0]?.data).toEqual([]);
	});
});

describe('candleSummary (doc 13 §8)', () => {
	it('reports the window open, close and the band it moved through', () => {
		expect(candleSummary(CANDLES)).toEqual({
			open: 100,
			close: 92,
			low: 90,
			high: 120,
			change: (92 - 100) / 100
		});
	});

	it('finds the extremes anywhere in the series, not only at its ends', () => {
		// The high is in the middle candle and the low is in the last one, so a
		// summary built from first and last alone would report neither.
		const summary = candleSummary(CANDLES);

		expect(summary?.high).toBe(120);
		expect(summary?.low).toBe(90);
	});

	it('has nothing to say about an empty series', () => {
		expect(candleSummary([])).toBeNull();
	});
});
