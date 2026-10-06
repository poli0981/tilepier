import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { calc } from './store.svelte';
import TpCalcDetail from './TpCalcDetail.svelte';

/**
 * doc 07 §3's detail: the session tape, and the scientific row that acts on
 * the value. No component test covered it until Week 8, and its `empty` — the
 * one this widget has, a tape with nothing on it — had none at all.
 */

function props() {
	return { instanceId: 'wgt_calc', settings: {}, close: vi.fn() };
}

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	settings.patch({ locale: 'en' });
	calc.reset();
});

afterEach(() => {
	cleanup();
	calc.reset();
	settings.dispose();
});

describe('the calculator detail (doc 07 §3)', () => {
	it('empty: a tape with nothing on it says so, and offers no clear', async () => {
		const screen = render(TpCalcDetail, props());

		await expect
			.element(screen.getByTestId('calc-tape-empty'))
			.toHaveTextContent(m['widget.calc.tape_empty']());
		await expect
			.element(screen.getByRole('button', { name: m['widget.calc.tape_clear']() }))
			.not.toBeInTheDocument();
	});

	it('keeps each result on the tape, recalls one, and clears them all', async () => {
		calc.append('12+30');
		calc.submit();
		const screen = render(TpCalcDetail, props());

		const row = screen.getByRole('button', {
			name: m['widget.calc.tape_recall']({ result: '42' })
		});
		await expect.element(row).toBeInTheDocument();

		calc.clear();
		await row.click();
		expect(calc.expression).toBe('42');

		await screen.getByRole('button', { name: m['widget.calc.tape_clear']() }).click();
		await expect.element(screen.getByTestId('calc-tape-empty')).toBeInTheDocument();
	});

	it('applies the scientific row to the value on the tile', async () => {
		calc.append('9');
		const screen = render(TpCalcDetail, props());

		await screen.getByTestId('calc-sci-sqrt').click();

		// It commits, as = does: the result goes on the tape, as sqrt(9).
		expect(calc.tape[0]).toEqual({ expression: 'sqrt(9)', result: '3' });
		await expect
			.element(screen.getByRole('button', { name: m['widget.calc.tape_recall']({ result: '3' }) }))
			.toBeInTheDocument();
	});
});
