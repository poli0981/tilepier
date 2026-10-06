import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../../app.css';
import appCss from '../../app.css?raw';
import { settings } from '$lib/stores/settings.svelte';
import { ACCENTS } from './settings/accents';

/**
 * Every colour pair the app draws, measured in the engine that draws it
 * (doc 12 §4, doc 13 §8, WCAG 2.2 1.4.3 and 1.4.11).
 *
 * Until Week 8 contrast was asserted against hex a test had typed itself
 * (`widgets/toolbox/color.test.ts`), so no token change could ever fail it, and
 * the light theme was never measured at all: its beacon — which is also the
 * focus ring — was 1.81:1 on white, and the gate's Accept button set paper text
 * on it at 1.60:1. This suite loads the real stylesheet, drives the real
 * settings store to each theme and accent, lets the browser resolve every
 * token (including the relative-colour beacon), paints the result to a canvas
 * and measures the pixels.
 *
 * A token this file does not know fails the coverage guard at the bottom, so
 * a new colour has to be given a role, and with it a pair, before it ships.
 */

type Rgb = [number, number, number];

const context = (() => {
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (ctx === null) throw new Error('no 2d context');
	return ctx;
})();

/** Paints `layers` bottom to top on one pixel and reads it back as sRGB. */
function paint(...layers: string[]): Rgb {
	context.clearRect(0, 0, 1, 1);
	for (const layer of layers) {
		context.fillStyle = 'rgba(0, 0, 0, 0)';
		context.fillStyle = layer;
		context.fillRect(0, 0, 1, 1);
	}
	const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
	return [r, g, b];
}

const probe = document.createElement('span');

/** A token as the engine resolves it, in whatever syntax it computes to. */
function resolved(token: string): string {
	expect(appCss, `${token} is not defined in app.css`).toContain(`${token}:`);
	probe.style.color = `var(${token})`;
	return getComputedStyle(probe).color;
}

function luminance([r, g, b]: Rgb): number {
	const linear = (channel: number): number => {
		const s = channel / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: Rgb, b: Rgb): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (light + 0.05) / (dark + 0.05);
}

const SURFACES = ['--color-ink-950', '--color-ink-900', '--color-ink-850'] as const;
const THEMES = ['dark', 'light'] as const;

/** Text needs 4.5:1 at the sizes the app sets it (doc 12 §3's scale is
 *  normal text throughout); a graphical object or a control's edge 3:1. */
const TEXT = 4.5;
const NON_TEXT = 3;

function apply(theme: (typeof THEMES)[number], accent = '#46d5c8'): void {
	settings.patch({ theme, accent });
	settings.applyToDocument();
}

/** hsl → the `#rrggbb` an `<input type="color">` would hand the store. */
function hex(color: string): string {
	return `#${paint(color)
		.map((channel) => channel.toString(16).padStart(2, '0'))
		.join('')}`;
}

/** Every accent a reader can end up with: the default, the six swatches, the
 *  colour picker's corners, and a sweep of fully saturated hues. */
const ACCENTS_UNDER_TEST = [
	...new Set<string>([
		'#46d5c8',
		...ACCENTS,
		'#000000',
		'#ffffff',
		'#808080',
		'#ff0000',
		'#ffff00',
		'#00ff00',
		'#00ffff',
		'#0000ff',
		'#ff00ff',
		...Array.from({ length: 12 }, (_, step) => hex(`hsl(${step * 30} 100% 50%)`))
	])
];

beforeEach(() => {
	document.body.appendChild(probe);
	settings.dispose();
	settings.hydrate();
});

afterEach(() => {
	probe.remove();
	settings.dispose();
});

describe.each(THEMES)('the %s theme', (theme) => {
	it.each([
		'--color-fg',
		'--color-fg-mute',
		'--color-fg-dim',
		'--color-up',
		'--color-down',
		'--color-warn',
		'--color-danger'
	])('sets %s as text at 4.5:1 or more on every surface', (token) => {
		apply(theme);
		const ink = paint(resolved(token));
		for (const surface of SURFACES) {
			const measured = ratio(ink, paint(resolved(surface)));
			expect(
				measured,
				`${theme}: ${token} on ${surface}: ${measured.toFixed(2)}`
			).toBeGreaterThanOrEqual(TEXT);
		}
	});

	it.each([
		'--color-scrollbar',
		'--color-chart-2',
		'--color-chart-3',
		'--color-chart-4',
		'--color-chart-5'
	])('draws %s at 3:1 or more on every surface', (token) => {
		apply(theme);
		const mark = paint(resolved(token));
		for (const surface of SURFACES) {
			const measured = ratio(mark, paint(resolved(surface)));
			expect(
				measured,
				`${theme}: ${token} on ${surface}: ${measured.toFixed(2)}`
			).toBeGreaterThanOrEqual(NON_TEXT);
		}
	});

	it.each(ACCENTS_UNDER_TEST)('keeps the beacon legible for the accent %s', (accent) => {
		apply(theme, accent);
		const beacon = paint(resolved('--color-beacon'));
		const deep = paint(resolved('--color-beacon-deep'));
		const ink950 = paint(resolved('--color-ink-950'));

		for (const surface of SURFACES) {
			const ground = resolved(surface);
			// As text and as the focus ring, on the bare surface…
			const bare = ratio(beacon, paint(ground));
			expect(bare, `${theme}: beacon on ${surface}: ${bare.toFixed(2)}`).toBeGreaterThanOrEqual(
				TEXT
			);
			// …and on its own wash over it: the edit strip, a pressed toggle.
			const washed = ratio(beacon, paint(ground, resolved('--color-beacon-soft')));
			expect(
				washed,
				`${theme}: beacon on its wash over ${surface}: ${washed.toFixed(2)}`
			).toBeGreaterThanOrEqual(TEXT);
		}
		// As a fill under ink-950 text: the gate's Accept, at rest and pressed.
		const fill = ratio(ink950, beacon);
		expect(fill, `${theme}: ink-950 on the beacon: ${fill.toFixed(2)}`).toBeGreaterThanOrEqual(
			TEXT
		);
		const pressed = ratio(ink950, deep);
		expect(
			pressed,
			`${theme}: ink-950 on beacon-deep: ${pressed.toFixed(2)}`
		).toBeGreaterThanOrEqual(TEXT);
	});
});

describe('coverage', () => {
	/** Every colour token app.css defines, and what it is measured as above.
	 *  Borders and gridlines are decoration: a control never relies on one
	 *  alone to be found (doc 13 §8). */
	const ROLES: Record<string, 'surface' | 'text' | 'non-text' | 'beacon' | 'decoration'> = {
		'--color-ink-950': 'surface',
		'--color-ink-900': 'surface',
		'--color-ink-850': 'surface',
		'--color-ink-700': 'decoration',
		'--color-ink-500': 'decoration',
		'--color-fg': 'text',
		'--color-fg-mute': 'text',
		'--color-fg-dim': 'text',
		'--color-up': 'text',
		'--color-down': 'text',
		'--color-warn': 'text',
		'--color-danger': 'text',
		'--color-beacon': 'beacon',
		'--color-beacon-soft': 'beacon',
		'--color-beacon-deep': 'beacon',
		'--color-scrollbar': 'non-text',
		'--color-chart-2': 'non-text',
		'--color-chart-3': 'non-text',
		'--color-chart-4': 'non-text',
		'--color-chart-5': 'non-text'
	};

	it('knows every colour token app.css defines', () => {
		const defined = new Set(
			Array.from(appCss.matchAll(/(--color-[\w-]+)\s*:/g), (match) => match[1])
		);
		expect(defined.size).toBeGreaterThan(0);
		for (const token of defined) {
			expect(ROLES, `${token} has no role here, so nothing measures it`).toHaveProperty([
				token as string
			]);
		}
	});
});
