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
	/** doc 12 §4.3's five-step ramp. Series-1 is the beacon — the accent is
	 *  user-overridable and the primary series follows it; 2–5 are charts-only
	 *  tokens (`--color-chart-2…5`), calibrated against each other rather than
	 *  against the UI palette, with values of their own in the light theme. */
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
 * doc 12 §2's dark values, for a token that is missing or cannot be painted —
 * the case that matters in practice being a component test, which renders
 * without `app.css`, so every read misses.
 */
const FALLBACK: TpChartTokens = {
	fg: '#DEE7EE',
	fgDim: '#738292',
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

/**
 * A colour token as the `#rrggbb` it paints, or null.
 *
 * zrender's colour parser takes named colours, `#rgb(a)`, `#rrggbb(aa)`,
 * `rgb(a)` and `hsl(a)` and silently returns nothing for anything else, so a
 * chart drawn from `oklch(…)` or `color-mix(…)` is invisible rather than
 * wrong. And `getPropertyValue()` on a custom property returns its
 * substituted-but-*unresolved* text — which is how a derived token used to
 * arrive. Until Week 8 the bridge therefore refused anything but literal hex.
 * That was safe while the store set the beacon to the reader's hex; once the
 * beacon was derived per theme in app.css (doc 12 §2), refusing it would have
 * pinned every chart's first series to the default teal, in both themes.
 *
 * So the token is painted: the engine resolves it as a `color`, a 1 × 1 canvas
 * draws that, and the pixel is the answer. A token the root does not define
 * is null before anything is painted — `color: var(--missing)` would quietly
 * paint the inherited text colour — and so is one this engine cannot parse.
 */
function painted(root: HTMLElement, name: string): string | null {
	const raw = getComputedStyle(root).getPropertyValue(name).trim();
	if (raw === '' || !CSS.supports('color', raw)) return null;

	const probe = document.createElement('span');
	probe.style.color = `var(${name})`;
	root.appendChild(probe);
	const resolved = getComputedStyle(probe).color;
	probe.remove();

	const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
	if (context === null) return null;
	// Transparent first: a value the canvas cannot parse leaves the previous
	// fill in place, and a transparent pixel reads as "no answer".
	context.fillStyle = 'rgba(0, 0, 0, 0)';
	context.fillStyle = resolved;
	context.fillRect(0, 0, 1, 1);
	const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
	if (a === 0) return null;
	return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export function readChartTokens(root: HTMLElement = document.documentElement): TpChartTokens {
	const read = (name: string, fallback: string): string => painted(root, name) ?? fallback;

	return {
		fg: read('--color-fg', FALLBACK.fg),
		fgDim: read('--color-fg-dim', FALLBACK.fgDim),
		grid: read('--color-ink-500', FALLBACK.grid),
		// The beacon, derived from the reader's accent (doc 12 §2): series-1
		// follows it, at the lightness the theme gives it.
		series1: read('--color-beacon', FALLBACK.series1),
		series2: read('--color-chart-2', FALLBACK.series2),
		series3: read('--color-chart-3', FALLBACK.series3),
		series4: read('--color-chart-4', FALLBACK.series4),
		series5: read('--color-chart-5', FALLBACK.series5),
		up: read('--color-up', FALLBACK.up),
		down: read('--color-down', FALLBACK.down)
	};
}

/** A `#rrggbb` in OKLab, or null for anything else. */
function oklab(hex: string): [number, number, number] | null {
	const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (match === null) return null;
	const [r, g, b] = match.slice(1, 4).map((pair) => {
		const c = Number.parseInt(pair, 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}

/** Closer than this in OKLab, two series read as one line (doc 12 §4.3). */
const DISTINCT_SERIES = 0.12;

function distance(a: string, b: string): number {
	const [x, y] = [oklab(a), oklab(b)];
	if (x === null || y === null) return Number.POSITIVE_INFINITY;
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * Steps 2–5 for this reader. Series 1 is their accent, so a step that reads as
 * the same colour is skipped and the next takes its place, in order — the ramp
 * descends in weight on purpose — with the text colour as the last resort.
 * Until Week 8 the ramp was fixed and a test asserted that steps 3–5 were not
 * one of the six swatches; step 2 *was* one (harbor blue), and amber and violet
 * sat 0.06 and 0.03 from steps 4 and 5, so three of the six swatches drew a
 * second series in the reader's own colour.
 */
function laterSeries(tokens: TpChartTokens): string[] {
	const candidates = [tokens.series2, tokens.series3, tokens.series4, tokens.series5, tokens.fg];
	const kept = candidates.filter((colour) => distance(colour, tokens.series1) >= DISTINCT_SERIES);
	// Only a five-series chart could show two in the text colour; none exists.
	while (kept.length < 4) kept.push(tokens.fg);
	return kept.slice(0, 4);
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
		color: [tokens.series1, ...laterSeries(tokens)],
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
