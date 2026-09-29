import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { toasts } from '$lib/stores/toast.svelte';
import TpToast from './TpToast.svelte';

/**
 * doc 13 §7's one toast slot, rendering each kind it can hold. The store's
 * timing is `stores/toast.svelte.test.ts`'s business; this is what the reader
 * sees.
 */

beforeEach(() => {
	toasts.reset();
});

afterEach(() => {
	cleanup();
	toasts.reset();
});

describe('TpToast', () => {
	it('says a 429 in its own words', async () => {
		const screen = render(TpToast);

		toasts.show({ kind: 'rate-limited' });

		await expect.element(screen.getByTestId('toast')).toHaveAttribute('data-kind', 'rate-limited');
		await expect.element(screen.getByText(m['common.toast.rate_limited']())).toBeVisible();
	});

	it('says a notice in whatever words it carries, resolved when it renders', async () => {
		let resolved = 0;
		const screen = render(TpToast);

		toasts.show({
			kind: 'notice',
			message: () => {
				resolved += 1;
				return 'Không phát được “Bài hát” — đã bỏ qua.';
			}
		});

		await expect.element(screen.getByText('Không phát được “Bài hát” — đã bỏ qua.')).toBeVisible();
		expect(resolved).toBeGreaterThan(0);
	});

	it('goes when dismissed', async () => {
		const screen = render(TpToast);
		toasts.show({ kind: 'notice', message: () => 'x' });
		await expect.element(screen.getByTestId('toast')).toBeVisible();

		await screen.getByRole('button', { name: m['common.dismiss']() }).click();

		expect(toasts.current).toBeNull();
	});
});
