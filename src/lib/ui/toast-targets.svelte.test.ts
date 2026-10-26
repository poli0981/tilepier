import '../../app.css';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { pwa } from '#lib/core/pwa.svelte.js';
import { m } from '#lib/paraglide/messages.js';
import { toasts } from '#lib/stores/toast.svelte.js';
import TpToast from './TpToast.svelte';
import TpUpdateToast from './TpUpdateToast.svelte';

/**
 * The toasts' buttons at the size doc 13 §8 sets outside a tile, 40 × 40, with
 * the real stylesheet — component tests otherwise run without app.css.
 *
 * Here because the nightly accessibility sweep found a dismiss button at 21 × 32
 * about once a week, on whichever night a toast happened to be up while it
 * scanned (`e2e/a11y.e2e.ts`, 2026-10-08 to 2026-10-26). A toast is too
 * occasional for a scan to be the test of its size.
 */

const TARGET = 40;

function box(name: string): DOMRect {
	const button = Array.from(document.querySelectorAll('button')).find(
		(element) => element.getAttribute('aria-label') === name || element.textContent?.trim() === name
	);
	if (button === undefined) throw new Error(`no button "${name}"`);
	return button.getBoundingClientRect();
}

beforeEach(() => {
	toasts.reset();
	pwa.dismiss();
});

afterEach(() => {
	cleanup();
	toasts.reset();
	pwa.dismiss();
});

describe('toast targets', () => {
	it('gives the notice its dismiss button at 40 × 40', async () => {
		const screen = await render(TpToast);
		toasts.show({ kind: 'rate-limited' });
		await expect.element(screen.getByTestId('toast')).toBeVisible();

		const dismiss = box(m['common.dismiss']());
		expect(dismiss.width).toBeGreaterThanOrEqual(TARGET);
		expect(dismiss.height).toBeGreaterThanOrEqual(TARGET);
	});

	it.each(['update-toast', 'offline-ready'] as const)(
		'gives the %s toast its buttons at 40 × 40',
		async (testId) => {
			const screen = await render(TpUpdateToast);
			if (testId === 'update-toast') pwa.updateReady = true;
			else pwa.offlineReady = true;
			await expect.element(screen.getByTestId(testId)).toBeVisible();

			const names = [m['common.dismiss']()];
			if (testId === 'update-toast') names.push(m['common.update.reload']());
			for (const name of names) {
				const target = box(name);
				expect(target.width, name).toBeGreaterThanOrEqual(TARGET);
				expect(target.height, name).toBeGreaterThanOrEqual(TARGET);
			}
		}
	);
});
