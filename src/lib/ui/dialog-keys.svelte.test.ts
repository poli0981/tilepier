import { afterEach, describe, expect, it, vi } from 'vitest';
import { FULLSCREEN_GRACE_MS, trapTab, watchFullscreen } from './dialog-keys';

/**
 * The edges of `dialog-keys.ts` the overlay's own tests do not reach: a panel
 * with nothing to focus, focus that has already escaped, and a watch that has
 * been let go. Browser project, because focus is the document's.
 */

let panel: HTMLElement;

function tab(shiftKey = false): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
	trapTab(panel, event);
	return event;
}

function mount(html: string): void {
	panel = document.createElement('div');
	panel.tabIndex = -1;
	panel.innerHTML = html;
	document.body.appendChild(panel);
}

afterEach(() => {
	panel.remove();
	vi.restoreAllMocks();
});

describe('trapTab', () => {
	it('holds focus on a panel with nothing inside to focus', () => {
		mount('<p>only words</p>');

		const event = tab();

		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(panel);
	});

	it('brings focus back in from outside, forwards to the first and backwards to the last', () => {
		mount('<button>one</button><button>two</button><button disabled>off</button>');
		const outside = document.createElement('button');
		document.body.appendChild(outside);
		const [one, two] = [...panel.querySelectorAll('button')];

		outside.focus();
		tab();
		expect(document.activeElement).toBe(one);

		outside.focus();
		tab(true);
		expect(document.activeElement).toBe(two);
		outside.remove();
	});

	it('leaves Tab between two controls to the browser, and ignores other keys', () => {
		mount('<button>one</button><button>two</button><button>three</button>');
		const two = panel.querySelectorAll('button')[1];
		two?.focus();

		expect(tab().defaultPrevented).toBe(false);
		const other = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
		trapTab(panel, other);
		expect(other.defaultPrevented).toBe(false);
	});
});

describe('watchFullscreen', () => {
	it('stops counting once let go', () => {
		let now = 1_000;
		const watch = watchFullscreen(() => now);
		watch.dispose();

		document.dispatchEvent(new Event('fullscreenchange'));

		expect(watch.escapeIsTheBrowsers()).toBe(false);
		now += FULLSCREEN_GRACE_MS;
		expect(watch.escapeIsTheBrowsers()).toBe(false);
	});

	it('counts the grace from the moment full screen ended', () => {
		let now = 1_000;
		const watch = watchFullscreen(() => now);

		document.dispatchEvent(new Event('fullscreenchange'));
		now += FULLSCREEN_GRACE_MS - 1;
		expect(watch.escapeIsTheBrowsers()).toBe(true);
		now += 1;
		expect(watch.escapeIsTheBrowsers()).toBe(false);
		watch.dispose();
	});
});
