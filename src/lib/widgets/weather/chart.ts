import { baseOption, type TpChartOption } from '$lib/charts/options';
import type { TpHourPoint } from './service';

/**
 * doc 08 §1's 24-hour combo: the temperature line and the precipitation-chance
 * bars, on two axes.
 *
 * Separate from the component so it is a pure function the node project can
 * assert — an option object is data, and the interesting parts of it (the gap
 * handling, the second axis, the absence of colour) are exactly the parts a
 * rendered-canvas test cannot see.
 *
 * **The cloud band doc 08 §1 also asks for is not here.** `cloud_cover` is not
 * among the nine hourly columns `/api/weather` requests, so plotting it needs a
 * `routes/api` change — and the air-quality call in that same file has its own
 * bug waiting (no `timezone` parameter at all), which wants fixing in the same
 * commit rather than separately. Both are written up in doc 08 §1; the chart
 * ships with two series.
 */

/**
 * No colours, and that is load-bearing rather than tidy: ECharts merges a theme
 * into the *defaults*, so any colour left in an option outranks the theme
 * forever and a theme switch re-themes nothing. `charts/theme.ts` owns them,
 * and series here take their colour by position from the theme's `color` array.
 */
export function hourlyOption(points: readonly TpHourPoint[]): TpChartOption {
	return {
		...baseOption(),
		xAxis: {
			type: 'time',
			// Hours, not dates: the window is a day and a date label on every tick
			// would repeat itself twenty-four times.
			axisLabel: { formatter: '{HH}:{mm}' }
		},
		yAxis: [
			{ type: 'value', axisLabel: { formatter: '{value}°' } },
			{
				type: 'value',
				min: 0,
				max: 100,
				// The bars' own axis is a scale the reader does not need drawn: the
				// bars are read against the line, and a second set of gridlines
				// would fight the first.
				splitLine: { show: false },
				axisLabel: { show: false }
			}
		],
		series: [
			{
				type: 'bar',
				yAxisIndex: 1,
				data: points.map((p) => [p.at, p.precipProb]),
				// Second in the theme's colour array, and behind the line.
				z: 1,
				barMaxWidth: 10
			},
			{
				type: 'line',
				yAxisIndex: 0,
				data: points.map((p) => [p.at, p.tempC]),
				smooth: true,
				showSymbol: false,
				// `false` is the point: a `null` is an hour upstream did not send,
				// and joining across it would draw a reading that does not exist.
				connectNulls: false,
				z: 2
			}
		]
	};
}
