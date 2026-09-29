import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpSeekBar from './TpSeekBar.svelte';

/**
 * The shared seek bar (doc 09 §2–§3): times as the reader reads them, a thumb
 * the playing position does not pull from under a finger, and one seek per
 * release.
 */

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
});

afterEach(() => {
	settings.dispose();
});

function drag(range: HTMLInputElement, value: number, release: boolean): void {
	range.value = String(value);
	range.dispatchEvent(new Event('input', { bubbles: true }));
	if (release) range.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('TpSeekBar', () => {
	it('shows where it is and how long it runs, and names the range', async () => {
		const screen = render(TpSeekBar, {
			positionMs: 65_000,
			durationMs: 187_000,
			label: 'position',
			onSeek: () => {}
		});

		const range = screen.getByRole('slider', { name: 'position' });
		await expect.element(range).toHaveAttribute('aria-valuetext', '1:05');
		await expect.element(screen.getByText('3:07')).toBeVisible();
	});

	it('holds the thumb where the reader drags it, and seeks once, on release', async () => {
		const onSeek = vi.fn();
		const screen = render(TpSeekBar, {
			positionMs: 10_000,
			durationMs: 100_000,
			label: 'position',
			onSeek
		});
		const range = screen.getByRole('slider', { name: 'position' }).element() as HTMLInputElement;

		drag(range, 60_000, false);
		// The player moves on while the thumb is held: the thumb stays put.
		await screen.rerender({ positionMs: 11_000 });
		expect(range.value).toBe('60000');
		expect(onSeek).not.toHaveBeenCalled();

		drag(range, 60_000, true);
		expect(onSeek).toHaveBeenCalledExactlyOnceWith(60_000);
		await screen.rerender({ positionMs: 60_000 });
		expect(range.value).toBe('60000');
	});

	it('can be switched off, as it is with nothing loaded', async () => {
		const screen = render(TpSeekBar, {
			positionMs: 0,
			durationMs: 0,
			label: 'position',
			onSeek: () => {},
			disabled: true,
			testid: 'seek'
		});

		await expect.element(screen.getByTestId('seek')).toBeDisabled();
	});
});
