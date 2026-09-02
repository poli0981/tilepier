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

/** What a TilePier chart draws with, resolved from `@theme`. */
export interface TpChartTokens {
	fg: string;
	fgDim: string;
	grid: string;
	/** doc 12 §4.3's five-step ramp. Only series-1 is a token — the accent is
	 *  user-overridable and the primary series follows it; the rest are fixed,
	 *  charts-only, and calibrated against each other rather than against the
	 *  UI palette. */
	series1: string;
	series2: string;
	series3: string;
	series4: string;
	series5: string;
	/**
	 * doc 12 §4.2's up/down pair, verified for deuteranopia.
	 *
	 * Here rather than in the `color` ramp because **a candlestick does not read
	 * the palette.** ECharts takes a candle's four colours from
	 * `itemStyle.color` / `color0` / `borderColor` / `borderColor0`, so the
	 * bridge built for the weather and currency charts in Week 4 would have left
	 * the markets detail drawing ECharts' own red and green — a pair nobody has
	 * checked, and one that ignores a reader's accent entirely.
	 */
	up: string;
	down: string;
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
	series2: '#7B8FF2',
	// Steps 3–5, added 2026-08-30 when the weather detail's cloud band became
	// the first third series. Deliberately descending in weight: step 3 is the
	// quietest, because a third series is usually context behind the first two
	// rather than a rival to them, and the accent must stay the one beacon in
	// the view (doc 12 §4.1). None of them is any of the six selectable accents
	// in Settings, so a reader's own colour cannot collide with a later series.
	series3: '#8798A8',
	series4: '#D9A441',
	series5: '#C084D6',
	up: '#57C785',
	down: '#E8705F'
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
		series2: FALLBACK.series2,
		series3: FALLBACK.series3,
		series4: FALLBACK.series4,
		series5: FALLBACK.series5,
		up: read('--color-up', FALLBACK.up),
		down: read('--color-down', FALLBACK.down)
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
		color: [tokens.series1, tokens.series2, tokens.series3, tokens.series4, tokens.series5],
		categoryAxis: axis,
		valueAxis: axis,
		timeAxis: axis,
		logAxis: axis,
		tooltip: {
			backgroundColor: tokens.grid,
			borderColor: tokens.grid,
			textStyle: { color: tokens.fg }
		},
		/*
		 * A candlestick ignores `color` above — its four colours come from its own
		 * `itemStyle`, and ECharts' built-in defaults for them are a red/green
		 * pair nobody in this repo has checked against doc 12 §4.2. Supplying them
		 * as *theme* defaults rather than in the option keeps the option
		 * colourless, which is the whole reason this file exists.
		 *
		 * `color`/`borderColor` are the rising candle, `color0`/`borderColor0` the
		 * falling one. Body and border share a colour: a hollow body at tile
		 * scale is a one-pixel outline around nothing.
		 */
		candlestick: {
			itemStyle: {
				color: tokens.up,
				color0: tokens.down,
				borderColor: tokens.up,
				borderColor0: tokens.down
			}
		}
	};
}
