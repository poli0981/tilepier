import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { TpArrangeMove, TpArrangeState } from '#lib/core/grid/arrange.js';
import { m } from '#lib/paraglide/messages.js';
import TpArrangeDialog from './TpArrangeDialog.svelte';

/**
 * The Arrange dialog (doc 13 §8; WCAG 2.1.1, 2.5.7): the keyboard and
 * single-pointer way to move a tile. Where a step lands is `arrange.ts`'s
 * business and has its own test; this is what the reader can press and hear.
 */

const ALL: Record<TpArrangeMove, boolean> = {
	left: true,
	right: true,
	up: true,
	down: true,
	wider: true,
	narrower: true,
	taller: true,
	shorter: true
};

function place(over: Partial<TpArrangeState> = {}): TpArrangeState {
	return { x: 2, y: 0, w: 3, h: 2, column: 12, can: { ...ALL }, ...over };
}

afterEach(() => cleanup());

/** As the detail panel's tests press keys: on the focused element, bubbling. */
function press(key: string, shiftKey = false): void {
	const target = document.activeElement ?? document.body;
	target.dispatchEvent(
		new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
	);
}

describe('TpArrangeDialog', () => {
	it('is a named dialog that says where the tile is, 1-based', async () => {
		const screen = await render(TpArrangeDialog, {
			name: 'Clock',
			place: place(),
			onMove: () => {},
			onClose: () => {}
		});

		await expect
			.element(screen.getByRole('dialog', { name: m['common.tile.arrange']({ name: 'Clock' }) }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByTestId('arrange-where'))
			.toHaveTextContent(
				m['common.arrange.position']({ column: 3, columns: 12, row: 1, w: 3, h: 2 })
			);
	});

	it('takes focus when it opens', async () => {
		const screen = await render(TpArrangeDialog, {
			name: 'Clock',
			place: place(),
			onMove: () => {},
			onClose: () => {}
		});

		await expect.element(screen.getByTestId('arrange-dialog')).toHaveFocus();
	});

	it('moves with the arrow keys and resizes with Shift', async () => {
		const onMove = vi.fn();
		const screen = await render(TpArrangeDialog, {
			name: 'Clock',
			place: place(),
			onMove,
			onClose: () => {}
		});
		await expect.element(screen.getByTestId('arrange-dialog')).toHaveFocus();

		press('ArrowRight');
		press('ArrowDown');
		press('ArrowRight', true);
		press('ArrowDown', true);

		expect(onMove.mock.calls.map(([move]) => move)).toEqual(['right', 'down', 'wider', 'taller']);
	});

	it('keeps a step with nowhere to go pressable, and says so instead of moving', async () => {
		// `aria-disabled`, not `disabled`: the button keeps focus at the edge,
		// which is exactly when the reader is pressing it.
		const onMove = vi.fn();
		const screen = await render(TpArrangeDialog, {
			name: 'Clock',
			place: place({ can: { ...ALL, left: false } }),
			onMove,
			onClose: () => {}
		});
		const left = screen.getByTestId('arrange-left');

		await expect.element(left).toHaveAttribute('aria-disabled', 'true');
		await expect.element(left).not.toHaveAttribute('disabled');
		// A DOM click: Playwright counts aria-disabled as disabled and would wait
		// for it to clear, while a real pointer presses it like any button.
		const button = left.element() as HTMLButtonElement;
		button.focus();
		button.click();

		expect(onMove).not.toHaveBeenCalled();
		await expect
			.element(screen.getByTestId('arrange-status'))
			.toHaveTextContent(m['common.arrange.blocked']());
		await expect.element(left).toHaveFocus();
	});

	it('announces each step through a region that was there from the start', async () => {
		const screen = await render(TpArrangeDialog, {
			name: 'Clock',
			place: place(),
			onMove: () => {},
			onClose: () => {}
		});
		const status = screen.getByTestId('arrange-status');

		await expect.element(status).toHaveAttribute('role', 'status');
		await expect.element(status).toHaveTextContent('');

		await screen.getByTestId('arrange-right').click();

		await expect.element(status).not.toHaveTextContent('');
	});

	it('keeps Tab inside', async () => {
		const screen = await render(TpArrangeDialog, {
			name: 'Clock',
			place: place(),
			onMove: () => {},
			onClose: () => {}
		});
		(screen.getByTestId('arrange-done').element() as HTMLElement).focus();

		press('Tab');

		const dialog = screen.getByTestId('arrange-dialog').element();
		expect(dialog.contains(document.activeElement)).toBe(true);
	});

	it('closes from Done and from its close button', async () => {
		const onClose = vi.fn();
		const screen = await render(TpArrangeDialog, {
			name: 'Clock',
			place: place(),
			onMove: () => {},
			onClose
		});

		await screen.getByTestId('arrange-done').click();
		await screen.getByRole('button', { name: m['common.dismiss']() }).click();

		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
