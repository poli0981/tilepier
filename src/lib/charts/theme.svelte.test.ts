import { afterEach, describe, expect, it } from 'vitest';
import { readChartTokens } from './theme';

/**
 * The DOM half of the bridge — the only part that touches `getComputedStyle`,
 * and the part where a token can arrive in a form zrender cannot parse.
 */

let host: HTMLElement | null = null;

/** Within one step per channel: a round trip through a colour space can land
 *  one either side of the original byte. */
function near(actual: string, expected: string): boolean {
	const bytes = (hex: string): number[] =>
		[1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
	const [a, b] = [bytes(actual), bytes(expected)];
	return a.every((channel, index) => Math.abs(channel - (b[index] ?? -9)) <= 1);
}

function withTokens(declarations: Record<string, string>): HTMLElement {
	const el = document.createElement('div');
	for (const [name, value] of Object.entries(declarations)) el.style.setProperty(name, value);
	// `appendChild`, not `append`: the Worker types in scope give `document.body`
	// a `Body.append` overload that takes a stream, and the DOM one loses.
	document.body.appendChild(el);
	host = el;
	return el;
}

afterEach(() => {
	host?.remove();
	host = null;
});

describe('readChartTokens', () => {
	it('reads the literal hex tokens', () => {
		const el = withTokens({
			'--color-fg': '#112233',
			'--color-fg-dim': '#445566',
			'--color-ink-500': '#778899',
			'--color-beacon': '#aabbcc',
			'--color-up': '#00ff00',
			'--color-down': '#ff0000'
		});

		expect(readChartTokens(el)).toEqual({
			fg: '#112233',
			fgDim: '#445566',
			grid: '#778899',
			series1: '#aabbcc',
			series2: '#7B8FF2',
			series3: '#8798A8',
			series4: '#D9A441',
			series5: '#C084D6',
			// Read rather than fixed: unlike steps 2-5 these are real UI tokens,
			// and a light theme mirrors them (doc 12 §2).
			up: '#00ff00',
			down: '#ff0000'
		});
	});

	it('resolves a derived token to the hex it paints', () => {
		// `getComputedStyle` returns a custom property's substituted-but-unresolved
		// text, and zrender drops anything that is not hex, rgb or hsl — a chart
		// drawn from `oklch()` is invisible rather than wrong. Until Week 8 this
		// refused such a token; now that the beacon is derived per theme it is
		// painted instead, or every chart's first series would be the default
		// teal whatever the reader chose.
		const el = withTokens({
			'--color-beacon': 'oklch(from #b48ce8 l c h)',
			'--color-fg': 'color-mix(in srgb, #ffffff 50%, #000000)'
		});

		const tokens = readChartTokens(el);
		expect(near(tokens.series1, '#b48ce8')).toBe(true);
		expect(near(tokens.fg, '#808080')).toBe(true);
	});

	it('falls back on a value the engine cannot paint', () => {
		const el = withTokens({ '--color-beacon': 'not a colour at all' });

		expect(readChartTokens(el).series1).toBe('#46D5C8');
	});

	it('falls back when a token is missing entirely', () => {
		// Which is the ordinary case in a component test: the suite renders
		// without `app.css`, so every read misses.
		const el = withTokens({});
		const tokens = readChartTokens(el);

		for (const value of Object.values(tokens)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('follows a user-chosen accent, because series-1 is the beacon', () => {
		// doc 12 §2: the accent is overridable in Settings; JavaScript sets
		// `--tp-accent` on `<html>`, and app.css derives `--color-beacon` from it.
		const el = withTokens({ '--color-beacon': '#b48ce8' });
		expect(readChartTokens(el).series1).toBe('#b48ce8');
	});
});
