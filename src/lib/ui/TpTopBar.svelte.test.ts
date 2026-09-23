import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { ui } from '$lib/stores/ui.svelte';
import TpTopBar from './TpTopBar.svelte';

/**
 * doc 13 §1: the bar hides on scroll-down and comes back on scroll-up.
 *
 * Driven by scrolling a real document in the browser project, because the
 * behaviour is a relationship between `scrollY` over time and an attribute —
 * a fake scroll event with no position behind it would test the handler's
 * shape and nothing it does.
 */

const TALL = 'tp-test-tall';

async function scrollTo(y: number): Promise<void> {
	window.scrollTo(0, y);
	// One frame for the scroll event, one for the rAF that settles it.
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function bar(): HTMLElement {
	const element = document.querySelector<HTMLElement>('[data-testid="top-bar"]');
	if (element === null) throw new Error('no top bar');
	return element;
}

beforeEach(() => {
	ui.reset();
	const spacer = document.createElement('div');
	spacer.id = TALL;
	spacer.style.height = '5000px';
	document.body.appendChild(spacer);
	window.scrollTo(0, 0);
});

afterEach(() => {
	ui.reset();
	document.getElementById(TALL)?.remove();
	window.scrollTo(0, 0);
});

describe('hide on scroll', () => {
	it('starts shown, hides going down, and comes back going up', async () => {
		render(TpTopBar);
		expect(bar().dataset['hidden']).toBe('false');

		await scrollTo(600);
		expect(bar().dataset['hidden']).toBe('true');

		await scrollTo(400);
		expect(bar().dataset['hidden']).toBe('false');
	});

	it('ignores a nudge smaller than the slop', async () => {
		render(TpTopBar);
		await scrollTo(600);
		await scrollTo(596);

		expect(bar().dataset['hidden']).toBe('true');
	});

	it('is always shown near the top of the page', async () => {
		render(TpTopBar);
		await scrollTo(600);
		await scrollTo(10);

		expect(bar().dataset['hidden']).toBe('false');
	});

	// WCAG 2.4.11: a keyboard user must never tab into a bar they cannot see.
	it('comes back the moment focus enters it', async () => {
		const screen = render(TpTopBar);
		await scrollTo(600);
		expect(bar().dataset['hidden']).toBe('true');

		(screen.getByTestId('open-drawer').element() as HTMLElement).focus();
		await expect.poll(() => bar().dataset['hidden']).toBe('false');
	});

	it('never hides in edit mode, whose strip hangs off the bar', async () => {
		render(TpTopBar);
		ui.toggleEdit();
		await scrollTo(600);

		expect(bar().dataset['hidden']).toBe('false');
	});

	it('never hides with the drawer open', async () => {
		render(TpTopBar);
		ui.openDrawer();
		await scrollTo(600);

		expect(bar().dataset['hidden']).toBe('false');
	});

	it('hides by transform only, so nothing below it moves', async () => {
		render(TpTopBar);
		const before = bar().getBoundingClientRect().height;
		await scrollTo(600);

		expect(getComputedStyle(bar()).transform).not.toBe('none');
		expect(bar().getBoundingClientRect().height).toBe(before);
	});
});
