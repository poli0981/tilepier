import { baseOption, type TpChartOption } from '$lib/charts/options';
import type { TpHistoryPoint } from './service';

/**
 * doc 08 §2's history line, over the snapshots `/api/fx` has been accumulating
 * since launch.
 *
 * Separate from the component so it is a pure function the node project can
 * assert — an option object is data, and the interesting parts of it (the time
 * axis, the gap handling, the absence of colour) are exactly the parts a
 * rendered-canvas test cannot see.
 */

/**
 * No colours, and that is load-bearing rather than tidy: ECharts merges a theme
 * into the *defaults*, so any colour left in an option outranks the theme
 * forever and a theme switch re-themes nothing. `charts/theme.ts` owns them.
 */
export function historyOption(points: readonly TpHistoryPoint[]): TpChartOption {
	return {
		...baseOption(),
		xAxis: {
			// doc 10 §3 is explicit: a **time** axis, never an index one. A day with
			// no snapshot is a legal gap, and an index axis would close it up —
			// drawing three days of movement in the space of one and saying nothing
			// about the silence in between.
			type: 'time',
			axisLabel: { formatter: '{dd}/{MM}' }
		},
		yAxis: {
			type: 'value',
			// A rate never approaches zero, so anchoring the axis there would flatten
			// a 2 % move into a straight line. Same reasoning as weather's
			// temperature axis, for the same reason.
			scale: true
		},
		series: [
			{
				type: 'line',
				data: points.map((p) => [p.at, p.rate]),
				showSymbol: false,
				// `false` is the point: a `null` is a day upstream published nothing,
				// and joining across it would draw a rate that never existed.
				connectNulls: false,
				/*
				 * **Deliberately unlike weather's line, which smooths.** Temperature
				 * is continuous, so a curve between two readings interpolates
				 * something real. A daily fix is a discrete observation — there was no
				 * rate between Monday's and Tuesday's — and a smoothed curve would
				 * invent one, complete with overshoot past both endpoints.
				 */
				smooth: false
			}
		]
	};
}
