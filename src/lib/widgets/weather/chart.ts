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
 * All three series doc 08 §1 asks for: the temperature line, the precipitation
 * bars, and the cloud band behind them. `cloud_cover` joined the endpoint's
 * hourly columns on 2026-08-30, alongside the air-quality timezone fix that
 * file had been carrying.
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
			{
				type: 'value',
				axisLabel: { formatter: '{value}°' },
				// Without this ECharts anchors a positive value axis at zero, and a
				// day that runs 22–34° spends two thirds of the chart on degrees the
				// forecast never reaches.
				scale: true
			},
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
		// Temperature first, because series order is what assigns the theme's
		// colours and doc 12 §4.1 gives the beacon to *the* primary element. The
		// forecast is the temperature; the rain chance is the context around it.
		// Paint order is `z`, so the line still sits above the bars.
		series: [
			{
				type: 'line',
				yAxisIndex: 0,
				data: points.map((p) => [p.at, p.tempC]),
				smooth: true,
				showSymbol: false,
				// `false` is the point: a `null` is an hour upstream did not send,
				// and joining across it would draw a reading that does not exist.
				connectNulls: false,
				z: 3
			},
			{
				type: 'bar',
				yAxisIndex: 1,
				data: points.map((p) => [p.at, p.precipProb]),
				z: 2,
				barMaxWidth: 10
			},
			{
				// The cloud band: third in the series list, so it takes step 3 of
				// doc 12 §4.3's ramp — the quietest one, which is what a band
				// sitting behind the other two should be. `areaStyle` with no
				// colour of its own inherits the series colour, so the theme still
				// owns it; only the opacity lives here, and an opacity is not a
				// colour.
				type: 'line',
				yAxisIndex: 1,
				data: points.map((p) => [p.at, p.cloudPct]),
				smooth: true,
				showSymbol: false,
				connectNulls: false,
				lineStyle: { opacity: 0 },
				areaStyle: { opacity: 0.16 },
				z: 1
			}
		]
	};
}
