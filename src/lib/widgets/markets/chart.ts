import type { TpCryptoCandle } from '$lib/api-types';
import type { TpChartOption } from '$lib/charts/options';

/**
 * doc 09 §1's candlestick and volume band.
 *
 * **Colourless by construction**, like every option in this repo: `setTheme`
 * merges into the chart's *defaults* and an explicit option value outranks it
 * forever, so a colour written here could never follow a theme switch.
 * `charts/theme.ts` supplies all of them — including the four a candlestick
 * needs, which it did not until 2026-09-01: ECharts takes a candle's colours
 * from `itemStyle.color`/`color0`/`borderColor`/`borderColor0` rather than from
 * the series palette, so the bridge built in Week 4 covered every chart in the
 * app except this one.
 *
 * **`baseOption()` is deliberately not used here.** It describes one grid, and
 * this is two — the candles above, the volume below, sharing an x axis. The
 * geometry it carries is re-stated per grid instead of inherited, which is
 * three duplicated numbers against a helper that would have to grow an
 * either/or to serve both shapes.
 */

/** Where the candle grid ends and the volume band begins, in per cent of the
 *  chart's height. The gap between them is the volume axis's own labels. */
const CANDLE_HEIGHT = '58%';
const VOLUME_TOP = '76%';
const VOLUME_HEIGHT = '16%';

/**
 * ECharts wants a candle as `[open, close, low, high]` — **close second, not
 * last**, which is the one thing about this series type that is easy to get
 * wrong and produces a chart that looks plausible: every body is inverted and
 * every wick is the wrong way up, but the shape still reads as a market.
 *
 * doc 10 §4's tuple is `[t, open, high, low, close, volume]`, in Binance's
 * order. The reorder happens here, once, rather than at the call site.
 */
function candleValues(candle: TpCryptoCandle): [number, number, number, number, number] {
	const [t, open, high, low, close] = candle;
	return [t, open, close, low, high];
}

export interface TpCandleOptions {
	/**
	 * How a price label is written. A function rather than a digit count,
	 * because the digits are only half of it: doc 09 §1's precision has to meet
	 * doc 14 §3's "never hand-roll a number", and the locale lives in a store
	 * this module has no business importing.
	 */
	formatPrice: (value: number) => string;
	/** Rendered on the volume axis; the caller owns the localisation. */
	volumeLabel: string;
}

export function candlestickOption(
	candles: readonly TpCryptoCandle[],
	options: TpCandleOptions
): TpChartOption {
	// `as const` so the two string members narrow to their literal unions rather
	// than widening to `string`, which `GridOption` rejects.
	const shared = {
		left: 8,
		right: 8,
		outerBoundsMode: 'same',
		outerBoundsContain: 'axisLabel'
	} as const;

	return {
		grid: [
			{ ...shared, top: 16, height: CANDLE_HEIGHT },
			{ ...shared, top: VOLUME_TOP, height: VOLUME_HEIGHT }
		],
		xAxis: [
			// A **time** axis, not a category one: a gap upstream did not send is a
			// gap, and a category axis would close it up and draw a market that
			// never stopped trading. `normalizeCryptoKlines` drops unreadable rows
			// rather than zero-filling them, which is what makes that reachable.
			{ type: 'time', gridIndex: 0, axisLabel: { hideOverlap: true } },
			{ type: 'time', gridIndex: 1, axisLabel: { show: false } }
		],
		yAxis: [
			{
				// `scale: true` because a market that moved 0.4 % in a day is a flat
				// line against an axis anchored at zero.
				scale: true,
				gridIndex: 0,
				axisLabel: { formatter: options.formatPrice, showMinLabel: false },
				splitNumber: 4
			},
			{
				gridIndex: 1,
				name: options.volumeLabel,
				nameGap: 2,
				nameTextStyle: { align: 'left' },
				axisLabel: { show: false },
				splitLine: { show: false },
				splitNumber: 1
			}
		],
		dataZoom: [
			// Both axes, or scrubbing the candles leaves the volume band behind.
			{ type: 'inside', xAxisIndex: [0, 1] },
			{ type: 'slider', xAxisIndex: [0, 1], bottom: 0, height: 16 }
		],
		tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
		series: [
			{
				type: 'candlestick',
				data: candles.map(candleValues),
				encode: { x: 0, y: [1, 2, 3, 4] }
			},
			{
				type: 'bar',
				xAxisIndex: 1,
				yAxisIndex: 1,
				data: candles.map((candle) => [candle[0], candle[5]]),
				// Quiet on purpose: the volume band is context under the candles
				// rather than a second reading, and doc 12 §4.1 allows one beacon.
				itemStyle: { opacity: 0.45 },
				large: true
			}
		]
	};
}

/**
 * doc 13 §8's accessible summary line, as data.
 *
 * "every ECharts view paired with an accessible summary line" — and the pairing
 * is what makes a chart honest for a reader who cannot see it, so it carries
 * the same four facts the picture does: where the window opened, where it
 * closed, and the band it moved through.
 *
 * `null` when there is nothing to summarise, so the caller renders the empty
 * state rather than a sentence about no candles.
 */
export function candleSummary(
	candles: readonly TpCryptoCandle[]
): { open: number; close: number; low: number; high: number; change: number } | null {
	const first = candles[0];
	const last = candles.at(-1);
	if (first === undefined || last === undefined || first[1] === 0) return null;

	let low = first[3];
	let high = first[2];
	for (const candle of candles) {
		if (candle[3] < low) low = candle[3];
		if (candle[2] > high) high = candle[2];
	}

	return {
		open: first[1],
		close: last[4],
		low,
		high,
		change: (last[4] - first[1]) / first[1]
	};
}
