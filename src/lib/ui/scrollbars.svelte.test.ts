import { afterEach, describe, expect, it } from 'vitest';
import '../../app.css';

/**
 * The scrollbar rules of doc 12 §9, read off computed style.
 *
 * Pixels cannot show them here: Playwright runs headless Chromium with
 * `--hide-scrollbars`, so every scrollbar in this project is 0 px wide (doc 19
 * §4). The computed values are the contract, and they are visible under the
 * flag; `e2e/scrollbars` measures what they do to a real scrollbar.
 *
 * Component tests run without app.css; this one imports it, because the rules
 * under test live nowhere else.
 */

const created: HTMLElement[] = [];

/** A scroll container, as every list and pane in the app is one. */
function pane(): HTMLElement {
	const element = document.createElement('div');
	element.style.overflow = 'auto';
	document.body.appendChild(element);
	created.push(element);
	return element;
}

/** What a token resolves to, through the same engine that paints the bar. */
function resolved(token: string): string {
	const probe = pane();
	probe.style.color = `var(${token})`;
	return getComputedStyle(probe).color;
}

afterEach(() => {
	for (const element of created.splice(0)) element.remove();
});

const root = document.documentElement;

describe('scrollbars (doc 12 §9)', () => {
	it('reserves the page gutter, so a scrollbar appearing moves nothing', () => {
		expect(getComputedStyle(root).scrollbarGutter).toBe('stable');
	});

	it('draws the page and every pane thin', () => {
		expect(getComputedStyle(root).scrollbarWidth).toBe('thin');
		expect(getComputedStyle(pane()).scrollbarWidth).toBe('thin');
	});

	it('paints the thumb with the theme token on a transparent track, in both themes', () => {
		const thumbs: string[] = [];
		for (const theme of ['dark', 'light']) {
			root.setAttribute('data-theme', theme);
			const thumb = resolved('--color-scrollbar');
			thumbs.push(thumb);

			// Inherited, so a pane gets it without a rule of its own.
			expect(getComputedStyle(pane()).scrollbarColor, theme).toBe(`${thumb} rgba(0, 0, 0, 0)`);
		}
		// A light theme still showing the dark thumb would be a token never overridden.
		expect(thumbs[0]).not.toBe(thumbs[1]);
	});

	it('hides every one of them on request, without stopping anything scrolling', () => {
		root.setAttribute('data-scrollbars', 'hidden');
		const inner = pane();

		expect(getComputedStyle(root).scrollbarWidth).toBe('none');
		expect(getComputedStyle(inner).scrollbarWidth).toBe('none');
		// Hidden is never overflow: hidden — the page still scrolls.
		expect(getComputedStyle(root).overflowY).not.toBe('hidden');
		expect(getComputedStyle(inner).overflowY).toBe('auto');
	});
});
