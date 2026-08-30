import type { BarSeriesOption, CandlestickSeriesOption, LineSeriesOption } from 'echarts/charts';
import type {
	DataZoomComponentOption,
	GridComponentOption,
	TooltipComponentOption
} from 'echarts/components';
import type { ComposeOption } from 'echarts/core';

/**
 * The option vocabulary, and the geometry every chart shares.
 *
 * **Every import here is `import type`, and that is the whole reason this file
 * exists.** Type imports are erased, so a widget can build its option without
 * pulling echarts into its own chunk — whereas importing anything *runtime*
 * from `./echarts` would fold ~183 KB into whichever chunk did it, and
 * `scripts/budgets.json`'s `echarts` row would then match no file and fail the
 * gate outright (doc 20 §6). `./echarts` is reached only through
 * `() => import()`, and only by `TpChart.svelte`.
 */

/**
 * What a TilePier chart may use — the pieces `echarts.ts` actually registers
 * and nothing else, so a widget cannot quietly depend on a component that was
 * never `use`d and then render an empty box.
 */
export type TpChartOption = ComposeOption<
	| LineSeriesOption
	| BarSeriesOption
	| CandlestickSeriesOption
	| GridComponentOption
	| TooltipComponentOption
	| DataZoomComponentOption
>;

/**
 * Geometry and behaviour every chart shares. **Colourless by construction** —
 * `theme.ts` supplies every colour, because ECharts merges a theme into the
 * *defaults* and anything left in an option outranks it forever.
 *
 * `outerBoundsMode`/`outerBoundsContain` rather than `grid.containLabel`, which
 * ECharts 6 deprecated: it warns in dev and falls back internally unless
 * `LegacyGridContainLabel` is installed, and installing that would add bytes to
 * buy back a deprecated path.
 */
export function baseOption(): TpChartOption {
	return {
		grid: {
			left: 8,
			right: 8,
			top: 16,
			bottom: 8,
			outerBoundsMode: 'same',
			outerBoundsContain: 'axisLabel'
		},
		tooltip: { trigger: 'axis' }
	};
}
