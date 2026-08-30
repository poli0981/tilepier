import * as echarts from 'echarts/core';
import { BarChart, CandlestickChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

/**
 * ECharts entry point — the *only* place echarts is imported at runtime.
 *
 * Tree-shaken deliberately (doc 02, doc 20 §7): importing from `echarts` pulls
 * the whole library, so everything comes from `echarts/core` plus the exact
 * charts and components doc 07–09 need:
 *
 *  - line + bar     → weather 24h combo, currency history
 *  - candlestick    → markets detail (doc 09 §1)
 *  - dataZoom       → markets range scrubbing
 *  - tooltip + grid → every chart
 *
 * **Reached only through `() => import()`.** That is what keeps it in its own
 * lazy chunk, which doc 20 §6 counts once and `scripts/budgets.json` matches by
 * this module's path. A static import from a detail would fold ~183 KB into
 * that detail's chunk and the `echarts` row would then match no file at all —
 * `check-budgets.mjs` fails a non-optional row that matches nothing, so the
 * mistake is loud rather than silent. `charts/TpChart.svelte` is the one
 * component that loads it, from inside an effect.
 *
 * The option *vocabulary* lives in `options.ts` instead, where every import is
 * a type and therefore erased, so a widget can build an option without
 * reaching this module at all. Colours live in `theme.ts`, for the reason that
 * file explains at length.
 */

echarts.use([
	LineChart,
	BarChart,
	CandlestickChart,
	GridComponent,
	TooltipComponent,
	DataZoomComponent,
	CanvasRenderer
]);

export type TpChart = echarts.ECharts;

export function createChart(el: HTMLElement): TpChart {
	return echarts.init(el, undefined, { renderer: 'canvas' });
}

export { echarts };
