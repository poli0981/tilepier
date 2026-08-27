import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { forgetDetailComponent, type TpDetailState } from '$lib/core/detail';
import { m } from '$lib/paraglide/messages';
import { deck } from '$lib/stores/deck.svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpDetailOverlay from './TpDetailOverlay.svelte';

/**
 * doc 13 §5 and §8. Browser project because every claim here is about the
 * document: that the panel is a dialog, that all four ways out reach the same
 * close, and that focus goes back where it came from.
 *
 * The chunk cache's own behaviour (dedupe, remembered failures) is unit-tested
 * in `core/detail.test.ts`; what this file adds is that the component drives
 * it and renders each outcome.
 */

function openFor(): TpDetailState {
	const tile = deck.tiles[0];
	if (tile === undefined) throw new Error('the seeded deck should hold a clock tile');
	return {
		instanceId: tile.instanceId,
		widgetId: 'clock',
		rect: { x: 40, y: 60, width: 320, height: 180 }
	};
}

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	deck.dispose();
	deck.hydrate();
	// The cache is module-level and would otherwise carry a resolved clock
	// component from one file into the next.
	forgetDetailComponent('clock');
});

afterEach(() => {
	settings.dispose();
	deck.dispose();
	vi.restoreAllMocks();
});

describe('dialog semantics', () => {
	it('is a modal dialog named for its widget', async () => {
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose: () => {} });

		const panel = screen.getByTestId('detail-panel');
		await expect.element(panel).toBeVisible();
		await expect.element(panel).toHaveAttribute('aria-modal', 'true');
		// doc 13 §8: the panel is labelled, and it is labelled before its chunk
		// arrives — the name comes from the registry, not from the detail.
		await expect
			.element(screen.getByRole('heading', { name: m['widget.clock.title']() }))
			.toBeVisible();
	});

	it('takes focus on open', async () => {
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose: () => {} });

		const panel = screen.getByTestId('detail-panel');
		await expect.element(panel).toBeVisible();
		await vi.waitFor(() => {
			expect(document.activeElement).toBe(panel.element());
		});
	});

	it('returns focus to whatever opened it', async () => {
		// The tile's expand button, in effect: focus leaves it, and has to come
		// back when the panel goes (doc 13 §8).
		const opener = document.createElement('button');
		document.body.appendChild(opener);
		opener.focus();
		expect(document.activeElement).toBe(opener);

		const screen = render(TpDetailOverlay, { detail: openFor(), onClose: () => {} });
		await expect.element(screen.getByTestId('detail-panel')).toBeVisible();

		screen.unmount();

		await vi.waitFor(() => {
			expect(document.activeElement).toBe(opener);
		});
		opener.remove();
	});
});

describe('closing', () => {
	it('closes on the × button', async () => {
		const onClose = vi.fn();
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose });

		await screen.getByTestId('detail-close').click();

		// The exit animation runs first, so the callback lands a frame later.
		await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
	});

	it('closes on the scrim', async () => {
		const onClose = vi.fn();
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose });

		await screen.getByTestId('detail-scrim').click();

		await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
	});

	it('closes on Escape', async () => {
		const onClose = vi.fn();
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose });
		await expect.element(screen.getByTestId('detail-panel')).toBeVisible();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
	});

	it('ignores keys that are not Escape', async () => {
		const onClose = vi.fn();
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose });
		await expect.element(screen.getByTestId('detail-panel')).toBeVisible();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));

		expect(onClose).not.toHaveBeenCalled();
	});

	it('closes once however many times it is asked', async () => {
		// Esc pressed twice while the exit animation is still running. The panel
		// is already leaving, and popping two history entries would take the user
		// a page further back than they asked to go.
		//
		// The scrim is deliberately *not* part of this: it fades to opacity 0 as
		// soon as `closing` flips, so a click on it is correctly refused as
		// unactionable. That is the behaviour, not an obstacle to testing it —
		// the guard has to hold for the paths that stay clickable.
		const onClose = vi.fn();
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose });
		await expect.element(screen.getByTestId('detail-panel')).toBeVisible();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await screen.getByTestId('detail-close').click();

		await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('stops the scrim responding once it is on its way out', async () => {
		// The fade is what makes the double-close above impossible by that route.
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose: () => {} });
		const scrim = screen.getByTestId('detail-scrim');
		await expect.element(scrim).toBeVisible();

		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

		await vi.waitFor(() => {
			expect(scrim.element().className).toContain('closing');
		});
	});
});

describe('content', () => {
	it('renders the widget detail once its chunk arrives', async () => {
		const screen = render(TpDetailOverlay, { detail: openFor(), onClose: () => {} });

		// The clock detail's own hero label — proof the real chunk mounted, not
		// just that the frame did.
		await expect.element(screen.getByText(m['widget.clock.detail.home']())).toBeVisible();
	});

	it('says so when the tile is no longer on the deck', async () => {
		// Removed in another tab, or the deck was reset while the panel was open.
		const screen = render(TpDetailOverlay, {
			detail: { instanceId: 'wgt_missing', widgetId: 'clock' },
			onClose: () => {}
		});

		await expect.element(screen.getByText(m['common.detail.gone']())).toBeVisible();
	});
});
