/**
 * ECharts entry point — the *only* place echarts is imported.
 *
 * Tree-shaken deliberately (doc 02, doc 20 §7): importing from `echarts` pulls
 * the whole library, so everything comes from `echarts/core` plus the exact
 * charts and components doc 07–09 need:
 *
 *  - line + bar     → weather 24h combo, currency history, timer sparkline
 *  - candlestick    → markets detail (doc 09 §1)
 *  - dataZoom       → markets range scrubbing
 *  - tooltip + grid → every chart
 *
 * This module is loaded through a dynamic import so it lands in its own lazy
 * chunk, shared by every detail view that charts (doc 20 §6 counts it once).
 */
import * as echarts from 'echarts/core';
import { BarChart, CandlestickChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
	LineChart,
	BarChart,
	CandlestickChart,
	GridComponent,
	TooltipComponent,
	DataZoomComponent,
	CanvasRenderer
]);

export type TpChart = ReturnType<typeof echarts.init>;

/**
 * Charts read colours from the `@theme` tokens rather than hardcoding hex
 * (doc 12 §2/§4), so a theme switch re-themes them without disposing.
 */
function tokens(): { fg: string; fgDim: string; grid: string; beacon: string; series2: string } {
	const style = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	return {
		fg: read('--color-fg', '#DEE7EE'),
		fgDim: read('--color-fg-dim', '#5C6B7A'),
		grid: read('--color-ink-500', '#3A4756'),
		beacon: read('--color-beacon', '#46D5C8'),
		// Harbor blue — charts only, never a UI token (doc 12 §4.3).
		series2: '#7B8FF2'
	};
}

/** Base option every chart extends. Keeps axis and tooltip styling in one place. */
export function baseOption() {
	const t = tokens();
	return {
		textStyle: { color: t.fg, fontFamily: 'JetBrains Mono, ui-monospace, monospace' },
		grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
		xAxis: {
			type: 'time' as const,
			axisLine: { lineStyle: { color: t.grid } },
			axisLabel: { color: t.fgDim }
		},
		yAxis: {
			type: 'value' as const,
			splitLine: { lineStyle: { color: t.grid, opacity: 0.35 } },
			axisLabel: { color: t.fgDim }
		},
		tooltip: { trigger: 'axis' as const },
		color: [t.beacon, t.series2],
		animation: false
	};
}

export function createChart(el: HTMLElement): TpChart {
	return echarts.init(el, undefined, { renderer: 'canvas' });
}

export { echarts };
