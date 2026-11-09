import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ui } from './ui.svelte';

/** doc 13 §2 and §8 — the layer rules, which are all this store is. */

beforeEach(() => ui.reset());
afterEach(() => ui.reset());

describe('edit mode', () => {
	it('starts off and toggles', () => {
		expect(ui.editMode).toBe(false);
		ui.toggleEdit();
		expect(ui.editMode).toBe(true);
	});

	it('closes the drawer on the way out', () => {
		ui.openDrawer();

		ui.toggleEdit();

		// Leaving edit mode with the drawer open strands it over an inert grid,
		// where its Add buttons still work but nothing can be moved.
		expect(ui.editMode).toBe(false);
		expect(ui.drawerOpen).toBe(false);
	});
});

describe('the drawer', () => {
	it('enters edit mode when it opens (doc 13 §4)', () => {
		ui.openDrawer();

		expect(ui.drawerOpen).toBe(true);
		expect(ui.editMode).toBe(true);
	});

	it('closes without leaving edit mode', () => {
		ui.openDrawer();

		ui.closeDrawer();

		expect(ui.drawerOpen).toBe(false);
		expect(ui.editMode).toBe(true);
	});
});

describe('escape', () => {
	it('unwinds one layer at a time, topmost first', () => {
		ui.openDrawer();
		ui.toggleShortcuts();

		expect(ui.escape()).toBe(true);
		expect(ui.shortcutsOpen).toBe(false);
		expect(ui.drawerOpen).toBe(true);

		expect(ui.escape()).toBe(true);
		expect(ui.drawerOpen).toBe(false);
		expect(ui.editMode).toBe(true);

		expect(ui.escape()).toBe(true);
		expect(ui.editMode).toBe(false);
	});

	it('reports when there was nothing to close', () => {
		// The caller can then let the key fall through rather than swallowing it.
		expect(ui.escape()).toBe(false);
	});
});

describe('the shortcuts sheet', () => {
	it('toggles without touching edit mode', () => {
		ui.toggleShortcuts();

		expect(ui.shortcutsOpen).toBe(true);
		expect(ui.editMode).toBe(false);

		ui.closeShortcuts();
		expect(ui.shortcutsOpen).toBe(false);
	});
});

describe('the Arrange dialog (doc 13 §8)', () => {
	it('opens only in edit mode, and over the drawer', () => {
		ui.startArranging('wgt_a');
		expect(ui.arranging).toBeNull();

		ui.openDrawer();
		ui.startArranging('wgt_a');

		expect(ui.arranging).toBe('wgt_a');
		expect(ui.drawerOpen).toBe(false);
	});

	it('is the layer Esc closes before edit mode, so one Esc never does both', () => {
		// The dialog leaves Esc to this store on purpose: the layout's listener is
		// on `window` and runs first, so a handler of the dialog's own could not
		// stop it, and one keystroke closed the dialog and left edit mode too.
		ui.toggleEdit();
		ui.startArranging('wgt_a');

		expect(ui.escape()).toBe(true);
		expect(ui.arranging).toBeNull();
		expect(ui.editMode).toBe(true);
	});

	it('goes with edit mode, and gives way to the shortcuts sheet', () => {
		ui.toggleEdit();
		ui.startArranging('wgt_a');
		ui.toggleShortcuts();

		expect(ui.escape()).toBe(true);
		expect(ui.shortcutsOpen).toBe(false);
		expect(ui.arranging).toBe('wgt_a');

		ui.toggleEdit();
		expect(ui.arranging).toBeNull();
	});
});

describe('closing the Arrange dialog', () => {
	it('closes it and leaves edit mode on', () => {
		ui.toggleEdit();
		ui.startArranging('wgt_a');

		ui.stopArranging();

		expect(ui.arranging).toBeNull();
		expect(ui.editMode).toBe(true);
	});
});
