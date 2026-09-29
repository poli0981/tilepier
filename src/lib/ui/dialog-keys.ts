/**
 * The keyboard half of a modal panel (doc 13 §8), outside `TpDetailOverlay`,
 * which is past doc 20 §3's size already.
 *
 * **Tab stays inside.** `aria-modal` tells a screen reader the rest of the page
 * is inert; it does nothing for Tab, which walked out of the panel into the
 * deck behind the scrim until Week 7b (doc 13 §8 promised the trap since Week 2).
 *
 * **Escape is the browser's while something is full screen.** Chrome swallows
 * Escape to leave full screen and the page never sees it; other engines have
 * delivered it as well, and then one key press would take the reader out of the
 * video and out of the detail. So while `document.fullscreenElement` is set,
 * and for `FULLSCREEN_GRACE_MS` after it clears, Escape is left alone.
 */

const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
	'audio[controls]',
	'video[controls]',
	'[contenteditable="true"]'
].join(',');

/** How long after leaving full screen an Escape still counts as the browser's. */
export const FULLSCREEN_GRACE_MS = 500;

function focusableIn(panel: HTMLElement): HTMLElement[] {
	return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(element) => element.getClientRects().length > 0
	);
}

/**
 * Keeps a Tab keypress inside `panel`: past the last control it wraps to the
 * first, before the first to the last, and from outside the panel it comes
 * back in. In between, the browser moves focus as usual.
 */
export function trapTab(panel: HTMLElement, event: KeyboardEvent): void {
	if (event.key !== 'Tab') return;
	const focusable = focusableIn(panel);
	const first = focusable[0];
	const last = focusable.at(-1);
	const active = document.activeElement;
	const inside = active instanceof Node && panel.contains(active);

	if (first === undefined || last === undefined) {
		event.preventDefault();
		panel.focus();
		return;
	}
	if (event.shiftKey && (!inside || active === first || active === panel)) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (!inside || active === last)) {
		event.preventDefault();
		first.focus();
	}
}

export interface TpFullscreenWatch {
	/** True while something is full screen, and just after it left. */
	escapeIsTheBrowsers(): boolean;
	dispose(): void;
}

/** Watches the document's full screen, for `escapeIsTheBrowsers`. */
export function watchFullscreen(now: () => number = () => performance.now()): TpFullscreenWatch {
	let leftAt = Number.NEGATIVE_INFINITY;
	const onChange = (): void => {
		if (document.fullscreenElement === null) leftAt = now();
	};
	document.addEventListener('fullscreenchange', onChange);
	return {
		escapeIsTheBrowsers: () =>
			document.fullscreenElement !== null || now() - leftAt < FULLSCREEN_GRACE_MS,
		dispose: () => document.removeEventListener('fullscreenchange', onChange)
	};
}
