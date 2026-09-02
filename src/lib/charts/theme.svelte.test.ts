import { afterEach, describe, expect, it } from 'vitest';
import { readChartTokens } from './theme';

/**
 * The DOM half of the bridge — the only part that touches `getComputedStyle`,
 * and the part where a token can arrive in a form zrender cannot parse.
 */

let host: HTMLElement | null = null;

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

	it('refuses a derived token rather than handing zrender something it drops', () => {
		// `getComputedStyle` returns a custom property's substituted-but-unresolved
		// text, so `color-mix()` and `oklch()` arrive as those strings — and
		// zrender's parser handles named colours, #rgb(a), #rrggbb(aa), rgb(a) and
		// hsl(a), returning nothing for anything else. A chart drawn from one is
		// invisible rather than wrong, which is the harder failure to notice.
		const el = withTokens({
			'--color-beacon': 'color-mix(in oklch, #46d5c8 60%, white)',
			'--color-fg': 'oklch(from #dee7ee l c h)'
		});

		const tokens = readChartTokens(el);
		expect(tokens.series1).toBe('#46D5C8');
		expect(tokens.fg).toBe('#DEE7EE');
	});

	it('falls back when a token is missing entirely', () => {
		// Which is the ordinary case in a component test: the suite renders
		// without `app.css`, so every read misses.
		const el = withTokens({});
		const tokens = readChartTokens(el);

		for (const value of Object.values(tokens)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('follows a user-chosen accent, because series-1 is the accent', () => {
		// doc 12 §2: the accent is overridable in Settings, and JavaScript sets
		// exactly one property — `--color-beacon` — on `<html>`.
		const el = withTokens({ '--color-beacon': '#b48ce8' });
		expect(readChartTokens(el).series1).toBe('#b48ce8');
	});
});
