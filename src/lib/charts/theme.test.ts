import { describe, expect, it } from 'vitest';
import { chartTheme, type TpChartTokens } from './theme';

/**
 * The pure half of the token bridge. The half that reads the DOM is
 * `theme.svelte.test.ts`, in the browser project.
 */

const TOKENS: TpChartTokens = {
	fg: '#DEE7EE',
	fgDim: '#5C6B7A',
	grid: '#3A4756',
	series1: '#46D5C8',
	series2: '#7B8FF2',
	series3: '#8798A8',
	series4: '#D9A441',
	series5: '#C084D6',
	up: '#57C785',
	down: '#E8705F'
};

/** Every string anywhere in the theme, however deeply nested. */
function strings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
	return [];
}

describe('chartTheme', () => {
	it('puts the series colours in order, so a chart takes them by position', () => {
		// doc 12 §4.3's five steps, and the order is the whole contract: a series
		// takes its colour by its index in the option, so nothing else decides
		// which reading gets the beacon.
		expect(chartTheme(TOKENS).color).toEqual([
			'#46D5C8',
			'#7B8FF2',
			'#8798A8',
			'#D9A441',
			'#C084D6'
		]);
	});

	it('does not hand a later series one of the selectable accents', () => {
		// A reader can set the accent to any of six colours (doc 12 §2), and
		// series-1 follows it. If step 3, 4 or 5 were one of those, that reader's
		// chart would draw two series in the same colour.
		const accents = ['#46d5c8', '#7b8ff2', '#e8b750', '#57c785', '#e8705f', '#b48ce8'];
		const later = [TOKENS.series3, TOKENS.series4, TOKENS.series5].map((c) => c.toLowerCase());

		for (const colour of later) expect(accents, colour).not.toContain(colour);
	});

	it('themes every axis kind, not only the one the first chart happens to use', () => {
		// A weather chart is a time axis and a value axis; currency will add a
		// category one. Missing an axis kind shows up as unstyled gridlines in
		// whichever widget lands next, which is a bad way to find out.
		const theme = chartTheme(TOKENS);
		for (const key of ['categoryAxis', 'valueAxis', 'timeAxis', 'logAxis']) {
			expect(theme[key], key).toBeDefined();
		}
	});

	it('carries no colour that did not come from the tokens', () => {
		// The bridge's whole claim is that a theme switch re-themes everything.
		// A literal left in here is a colour that would survive the switch.
		const known = new Set(Object.values(TOKENS));
		const colours = strings(chartTheme(TOKENS)).filter((s) => s.startsWith('#'));

		expect(colours.length).toBeGreaterThan(0);
		for (const colour of colours) expect(known, colour).toContain(colour);
	});

	it('uses the mono face, because an axis is numbers the reader watches', () => {
		// CLAUDE.md rule 9, applied to the one place it is easy to forget.
		const theme = chartTheme(TOKENS) as { textStyle?: { fontFamily?: string } };
		expect(theme.textStyle?.fontFamily).toContain('JetBrains Mono');
	});

	it('is pure — the same tokens give an equal theme, and a different one differs', () => {
		expect(chartTheme(TOKENS)).toEqual(chartTheme(TOKENS));
		expect(chartTheme({ ...TOKENS, series1: '#ffffff' }).color).toEqual([
			'#ffffff',
			'#7B8FF2',
			'#8798A8',
			'#D9A441',
			'#C084D6'
		]);
	});
});

/**
 * The candle colours, added 2026-09-01 with the markets detail.
 *
 * A candlestick does not read the `color` ramp — ECharts takes its four
 * colours from `itemStyle.color`/`color0`/`borderColor`/`borderColor0` — so the
 * bridge the weather and currency charts were built on covered every chart in
 * the app except the one Week 5 is about.
 */
describe('candlestick colours (doc 12 §4.2)', () => {
	it('draws candles from the up/down tokens rather than from the palette', () => {
		const theme = chartTheme({ ...TOKENS, up: '#111111', down: '#222222' });
		const candlestick = theme['candlestick'] as { itemStyle: Record<string, string> };

		expect(candlestick.itemStyle['color']).toBe('#111111');
		expect(candlestick.itemStyle['borderColor']).toBe('#111111');
		expect(candlestick.itemStyle['color0']).toBe('#222222');
		expect(candlestick.itemStyle['borderColor0']).toBe('#222222');
	});

	it('keeps the pair out of the series ramp, where it would become a series', () => {
		const theme = chartTheme(TOKENS);

		expect(theme['color']).not.toContain(TOKENS.up);
		expect(theme['color']).not.toContain(TOKENS.down);
	});
});
