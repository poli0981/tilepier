import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpCalcWidget from './TpCalcWidget.svelte';
import { calc } from './store.svelte';

/**
 * doc 07 §3's tile. The arithmetic is proved in `engine.test.ts` against exact
 * decimal strings; what is checked here is the wiring — that a key press
 * reaches the store, that the result line is localised, and that an error is
 * shown inline rather than blanking the tile.
 */

const SIZE: TpTileSize = { w: 3, h: 3, pxW: 300, pxH: 300, tier: 'M' };

function props() {
	return { instanceId: 'wgt_calc', settings: {}, size: SIZE };
}

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	// The store is module-level by design (single-instance widget), so it has to
	// be reset between cases or the tape leaks from one into the next.
	calc.reset();
});

afterEach(() => {
	settings.dispose();
	calc.reset();
	vi.restoreAllMocks();
});

describe('entry', () => {
	it('starts at zero, not blank', async () => {
		const screen = render(TpCalcWidget, props());
		await expect.element(screen.getByTestId('calc-result')).toHaveTextContent('0');
	});

	it('builds an expression from the keypad', async () => {
		const screen = render(TpCalcWidget, props());

		await screen.getByTestId('calc-key-1').click();
		await screen.getByTestId('calc-key-2').click();
		await screen.getByTestId('calc-key-+').click();
		await screen.getByTestId('calc-key-3').click();

		await expect.element(screen.getByTestId('calc-entry')).toHaveTextContent('12+3');
		// The result line previews as you type rather than waiting for equals.
		await expect.element(screen.getByTestId('calc-result')).toHaveTextContent('15');
	});

	it('commits on equals and clears the entry line', async () => {
		const screen = render(TpCalcWidget, props());

		await screen.getByTestId('calc-key-7').click();
		await screen.getByTestId('calc-key-×').click();
		await screen.getByTestId('calc-key-6').click();
		await screen.getByTestId('calc-key-=').click();

		await expect.element(screen.getByTestId('calc-result')).toHaveTextContent('42');
		await expect.element(screen.getByTestId('calc-entry')).toHaveTextContent('');
		expect(calc.tape[0]?.result).toBe('42');
	});

	it('backspaces one character and clears the lot', async () => {
		const screen = render(TpCalcWidget, props());

		await screen.getByTestId('calc-key-1').click();
		await screen.getByTestId('calc-key-2').click();
		await screen.getByTestId('calc-backspace').click();
		await expect.element(screen.getByTestId('calc-entry')).toHaveTextContent('1');

		await screen.getByTestId('calc-clear').click();
		await expect.element(screen.getByTestId('calc-entry')).toHaveTextContent('');
	});
});

describe('keyboard', () => {
	it('takes digits and operators from the keyboard while focus is inside', async () => {
		// doc 07 §3: "keyboard input when focused". Focus lands on a key, and the
		// keystroke bubbles to the group's handler.
		const screen = render(TpCalcWidget, props());
		const key = screen.getByTestId('calc-key-1').element();
		(key as HTMLElement).focus();

		for (const char of ['4', '*', '3']) {
			key.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
		}

		await expect.element(screen.getByTestId('calc-entry')).toHaveTextContent('4*3');
		key.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await expect.element(screen.getByTestId('calc-result')).toHaveTextContent('12');
	});

	it('leaves Escape alone for the layer above', async () => {
		// doc 13 §8: Escape closes the topmost layer. Swallowing it here would
		// trap someone inside an open detail panel.
		const screen = render(TpCalcWidget, props());
		const key = screen.getByTestId('calc-key-1').element();
		(key as HTMLElement).focus();

		key.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		key.dispatchEvent(escape);

		expect(escape.defaultPrevented).toBe(false);
		await expect.element(screen.getByTestId('calc-entry')).toHaveTextContent('5');
	});
});

describe('errors', () => {
	it('says so inline when asked to divide by zero', async () => {
		const screen = render(TpCalcWidget, props());

		await screen.getByTestId('calc-key-1').click();
		await screen.getByTestId('calc-key-÷').click();
		await screen.getByTestId('calc-key-0').click();
		await screen.getByTestId('calc-key-=').click();

		await expect
			.element(screen.getByTestId('calc-error'))
			.toHaveTextContent(m['widget.calc.error.divide_zero']());
		// doc 17 §6 / doc 07 §3: the tile never blanks — the display is still there.
		await expect.element(screen.getByTestId('calc-result')).toBeVisible();
	});

	it('says so when the expression is unfinished', async () => {
		const screen = render(TpCalcWidget, props());

		await screen.getByTestId('calc-key-1').click();
		await screen.getByTestId('calc-key-+').click();
		await screen.getByTestId('calc-key-=').click();

		await expect
			.element(screen.getByTestId('calc-error'))
			.toHaveTextContent(m['widget.calc.error.syntax']());
	});

	it('clears the error on the next keystroke', async () => {
		const screen = render(TpCalcWidget, props());

		await screen.getByTestId('calc-key-1').click();
		await screen.getByTestId('calc-key-+').click();
		await screen.getByTestId('calc-key-=').click();
		await expect.element(screen.getByTestId('calc-error')).toBeVisible();

		await screen.getByTestId('calc-key-2').click();
		await expect.element(screen.getByTestId('calc-error')).not.toBeInTheDocument();
	});
});

describe('locale', () => {
	it('groups thousands the way the locale does', async () => {
		// doc 07 §3's result line. The catalogue's base locale is vi, which groups
		// with a full stop.
		settings.patch({ locale: 'vi' });
		const screen = render(TpCalcWidget, props());

		for (const key of ['1', '2', '3', '4', '5', '6', '7']) {
			await screen.getByTestId(`calc-key-${key}`).click();
		}

		await expect.element(screen.getByTestId('calc-result')).toHaveTextContent('1.234.567');
	});
});
