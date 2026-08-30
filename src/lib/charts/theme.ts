/**
 * The token → ECharts bridge (doc 12 §2, doc 03's `charts/` line).
 *
 * **Why this is a theme and not part of the option.** `chart.setTheme()` merges
 * into the chart's *defaults*; an explicit option value always wins over it. So
 * a chart whose option carries its colours can observe `data-theme`, call
 * `setTheme` on every switch, log nothing, throw nothing — and never change a
 * pixel. That is the failure mode this split exists to make impossible: the
 * option is colourless by construction, and every colour lives here.
 *
 * Split in two so the half that matters is testable without a DOM:
 * `readChartTokens` is the only thing that touches `getComputedStyle`, and
 * `chartTheme` is pure.
 */

/** The five values a TilePier chart needs, resolved from `@theme`. */
export interface TpChartTokens {
	fg: string;
	fgDim: string;
	grid: string;
	series1: string;
	series2: string;
}

/**
 * Literal hex, and it has to be.
 *
 * `getComputedStyle().getPropertyValue()` on a custom property returns the
 * substituted-but-*unresolved* token text, so `color-mix(in oklch, …)` and
 * `oklch(from …)` arrive at zrender as those strings — and zrender's colour
 * parser handles named colours, `#rgb(a)`, `#rrggbb(aa)`, `rgb(a)` and `hsl(a)`
 * and silently returns nothing for anything else. A chart drawn from a derived
 * token is invisible rather than wrong, which is harder to notice.
 *
 * These fall back to doc 12 §2's dark values, for the case that matters in
 * practice: a component test renders without `app.css`, so every read misses.
 */
const FALLBACK: TpChartTokens = {
	fg: '#DEE7EE',
	fgDim: '#5C6B7A',
	grid: '#3A4756',
	series1: '#46D5C8',
	// Harbor blue — charts only, never a UI token (doc 12 §4.3).
	series2: '#7B8FF2'
};

/** Anything that is not a literal hex is refused rather than passed on, so a
 *  derived token fails at the boundary instead of drawing nothing. */
function hexOr(value: string, fallback: string): string {
	const trimmed = value.trim();
	return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ? trimmed : fallback;
}

export function readChartTokens(root: HTMLElement = document.documentElement): TpChartTokens {
	const style = getComputedStyle(root);
	const read = (name: string, fallback: string): string =>
		hexOr(style.getPropertyValue(name), fallback);

	return {
		fg: read('--color-fg', FALLBACK.fg),
		fgDim: read('--color-fg-dim', FALLBACK.fgDim),
		grid: read('--color-ink-500', FALLBACK.grid),
		// The accent is user-overridable (doc 12 §2), so series-1 follows it.
		series1: read('--color-beacon', FALLBACK.series1),
		series2: FALLBACK.series2
	};
}

/**
 * Every colour and face a chart draws with, shaped for `setTheme`.
 *
 * Pure, so the node project can assert the whole palette — including that a
 * derived token never reaches it — without standing up a canvas.
 *
 * Typed structurally rather than as echarts' own `ThemeOption`, which the
 * package declares but does not export.
 */
export function chartTheme(tokens: TpChartTokens): Record<string, unknown> {
	const axis = {
		axisLine: { lineStyle: { color: tokens.grid } },
		axisTick: { lineStyle: { color: tokens.grid } },
		axisLabel: { color: tokens.fgDim },
		splitLine: { lineStyle: { color: tokens.grid, opacity: 0.35 } }
	};

	return {
		// doc 12 §3: numbers the reader watches are mono, and an axis is nothing
		// but numbers the reader watches.
		textStyle: { color: tokens.fg, fontFamily: 'JetBrains Mono, ui-monospace, monospace' },
		color: [tokens.series1, tokens.series2],
		categoryAxis: axis,
		valueAxis: axis,
		timeAxis: axis,
		logAxis: axis,
		tooltip: {
			backgroundColor: tokens.grid,
			borderColor: tokens.grid,
			textStyle: { color: tokens.fg }
		}
	};
}
