import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { m } from '#lib/paraglide/messages.js';
import { toasts } from '#lib/stores/toast.svelte.js';
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
		const screen = await render(TpToast);

		toasts.show({ kind: 'rate-limited' });

		await expect.element(screen.getByTestId('toast')).toHaveAttribute('data-kind', 'rate-limited');
		// textContent, not the matcher: the visible words are aria-hidden (the live
		// region below says them), and the matcher reads what is exposed.
		expect(screen.getByTestId('toast').element().textContent).toContain(
			m['common.toast.rate_limited']()
		);
	});

	it('says it through a live region that was there before the toast', async () => {
		// doc 13 §8's rule for live regions, which this one broke until 1.3.0:
		// `role="status"` arrived together with its words, and a region inserted
		// with its text already in it is not reliably announced.
		const screen = await render(TpToast);
		const region = screen.getByTestId('toast-announce');
		await expect.element(region).toHaveAttribute('role', 'status');
		await expect.element(region).toHaveTextContent('');

		toasts.show({ kind: 'rate-limited' });

		await expect.element(region).toHaveTextContent(m['common.toast.rate_limited']());
		// Read once: the visible words are hidden from the accessibility tree.
		await expect
			.element(screen.getByRole('status'))
			.toHaveTextContent(m['common.toast.rate_limited']());
	});

	it('says a notice in whatever words it carries, resolved when it renders', async () => {
		let resolved = 0;
		const screen = await render(TpToast);

		toasts.show({
			kind: 'notice',
			message: () => {
				resolved += 1;
				return 'Không phát được “Bài hát” — đã bỏ qua.';
			}
		});

		await expect.element(screen.getByTestId('toast')).toBeInTheDocument();
		expect(screen.getByTestId('toast').element().textContent).toContain(
			'Không phát được “Bài hát” — đã bỏ qua.'
		);
		expect(resolved).toBeGreaterThan(0);
	});

	it('goes when dismissed', async () => {
		const screen = await render(TpToast);
		toasts.show({ kind: 'notice', message: () => 'x' });
		await expect.element(screen.getByTestId('toast')).toBeVisible();

		await screen.getByRole('button', { name: m['common.dismiss']() }).click();

		expect(toasts.current).toBeNull();
	});
});
