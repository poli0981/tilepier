import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { m } from '#lib/paraglide/messages.js';
import { deck } from '#lib/stores/deck.svelte.js';
import { settings } from '#lib/stores/settings.svelte.js';
import { ui } from '#lib/stores/ui.svelte.js';
import TpAddDrawer from './TpAddDrawer.svelte';
import TpBugDialog from './TpBugDialog.svelte';
import TpShortcutsSheet from './TpShortcutsSheet.svelte';

/**
 * doc 13 §8's focus contract for the three panels that lacked it until 1.3.0:
 * focus goes in when one opens, Tab stays inside, and focus goes back to where
 * it was when it closes. The detail panel has had all three since Week 7b
 * (`TpDetailOverlay.svelte.test.ts`); these did not, and a keyboard reader who
 * opened the shortcuts sheet with `?` was left with focus behind it.
 */

/** As the detail panel's tests press keys: on the focused element, bubbling. */
function press(key: string, shiftKey = false): void {
	const target = document.activeElement ?? document.body;
	target.dispatchEvent(
		new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
	);
}

/** A button outside the panel to open it from, and to come back to. */
function opener(): HTMLButtonElement {
	const button = document.createElement('button');
	button.textContent = 'opener';
	document.body.appendChild(button);
	button.focus();
	return button;
}

beforeEach(() => {
	ui.reset();
	settings.dispose();
	localStorage.clear();
	settings.hydrate();
	deck.dispose();
	deck.hydrate();
});

afterEach(() => {
	cleanup();
	ui.reset();
	settings.dispose();
	deck.dispose();
	localStorage.clear();
	for (const button of document.querySelectorAll('body > button')) button.remove();
});

describe('the shortcuts sheet', () => {
	it('takes focus, keeps Tab, and hands focus back', async () => {
		const screen = await render(TpShortcutsSheet);
		const back = opener();

		ui.toggleShortcuts();
		const sheet = screen.getByTestId('shortcuts');
		await expect.element(sheet).toHaveFocus();

		// Its one control is the close button; Tab from it wraps rather than
		// walking out to the page behind the scrim.
		(screen.getByRole('button', { name: m['common.dismiss']() }).element() as HTMLElement).focus();
		press('Tab');
		expect(sheet.element().contains(document.activeElement)).toBe(true);

		ui.closeShortcuts();
		await expect.element(sheet).not.toBeInTheDocument();
		expect(document.activeElement).toBe(back);
	});

	it('lists the Arrange keys, and says when single-key shortcuts are off', async () => {
		const screen = await render(TpShortcutsSheet);
		ui.toggleShortcuts();

		await expect.element(screen.getByTestId('shortcuts-arrange')).toBeVisible();
		await expect.element(screen.getByTestId('shortcuts-off-note')).not.toBeInTheDocument();

		settings.patch({ shortcuts: 'off' });
		await expect
			.element(screen.getByTestId('shortcuts-off-note'))
			.toHaveTextContent(m['common.shortcuts.off_note']());
	});
});

describe('the add drawer', () => {
	it('keeps Tab inside', async () => {
		const screen = await render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();
		const drawer = screen.getByTestId('add-drawer');
		await expect.element(drawer).toHaveFocus();

		const buttons = [...drawer.element().querySelectorAll<HTMLElement>('button:not([disabled])')];
		buttons.at(-1)?.focus();
		press('Tab');

		expect(drawer.element().contains(document.activeElement)).toBe(true);
		expect(document.activeElement).not.toBe(buttons.at(-1));
	});

	it('names each Add button with its widget (WCAG 2.4.6, 2.5.3)', async () => {
		const screen = await render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();

		const add = screen.getByTestId('add-clock');
		await expect
			.element(add)
			.toHaveAccessibleName(m['common.add_named']({ name: m['widget.clock.title']() }));
		// The visible word starts the name, as 2.5.3 asks.
		expect(m['common.add_named']({ name: m['widget.clock.title']() })).toContain(m['common.add']());
	});
});

describe('the bug dialog', () => {
	it('takes focus, closes on Esc without the key reaching the page, and hands focus back', async () => {
		// It had no Esc at all until 1.3.0. On `document` and stopped there, so
		// the layout's `window` handler does not also leave edit mode.
		const onClose = vi.fn();
		const onWindow = vi.fn();
		window.addEventListener('keydown', onWindow);
		const back = opener();

		const screen = await render(TpBugDialog, { open: true, onClose });
		const dialog = screen.getByTestId('bug-dialog');
		await expect.element(dialog).toHaveFocus();

		press('Escape');

		expect(onClose).toHaveBeenCalledOnce();
		expect(onWindow).not.toHaveBeenCalled();
		window.removeEventListener('keydown', onWindow);

		await screen.rerender({ open: false, onClose });
		expect(document.activeElement).toBe(back);
	});

	it('keeps Tab inside', async () => {
		const screen = await render(TpBugDialog, { open: true, onClose: () => {} });
		const dialog = screen.getByTestId('bug-dialog');
		const last = screen.getByTestId('bug-download').element() as HTMLElement;
		last.focus();

		press('Tab');

		expect(dialog.element().contains(document.activeElement)).toBe(true);
		expect(document.activeElement).not.toBe(last);
	});
});
