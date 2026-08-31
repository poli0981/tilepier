import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF } from '$lib/shared-constants';
import { TOAST_MS, toasts } from './toast.svelte';

/**
 * doc 13 §7's toast, minus the markup.
 *
 * Fake timers throughout: the whole contract here is about *when* it goes away,
 * and a test that waited four real seconds would be four seconds of CI per case.
 */

beforeEach(() => {
	vi.useFakeTimers();
	toasts.reset();
});

afterEach(() => {
	toasts.reset();
	vi.useRealTimers();
});

describe('showing', () => {
	it('starts empty and stays empty', () => {
		expect(toasts.current).toBeNull();
	});

	it('shows, and takes itself away after four seconds', () => {
		toasts.show('rate-limited');
		expect(toasts.current).toBe('rate-limited');

		vi.advanceTimersByTime(TOAST_MS - 1);
		expect(toasts.current).toBe('rate-limited');

		vi.advanceTimersByTime(1);
		expect(toasts.current).toBeNull();
	});

	it('replaces rather than queues, and restarts the clock', () => {
		// doc 13 §7's "max 1 visible", stated as behaviour: a second notice does
		// not wait its turn, and it does not inherit the first one's remaining
		// time either — which is what a naive replace would do.
		toasts.show('rate-limited');
		vi.advanceTimersByTime(TOAST_MS - 100);

		toasts.show('rate-limited');
		vi.advanceTimersByTime(TOAST_MS - 100);
		expect(toasts.current).toBe('rate-limited');

		vi.advanceTimersByTime(100);
		expect(toasts.current).toBeNull();
	});
});

describe('dismissing', () => {
	it('goes immediately when the reader asks', () => {
		toasts.show('rate-limited');
		toasts.dismiss();
		expect(toasts.current).toBeNull();
	});

	it('does not come back when the timer it outran finally fires', () => {
		// The bug a bare `#current = null` would leave: dismiss, show again inside
		// four seconds, and the first timer clears the second toast early.
		toasts.show('rate-limited');
		toasts.dismiss();
		toasts.show('rate-limited');

		vi.advanceTimersByTime(TOAST_MS - 1);
		expect(toasts.current).toBe('rate-limited');
	});
});

describe('the window it lives in', () => {
	it('is shorter than the throttle that produces it', () => {
		// doc 17 §5 lets one rate-limit notice per 60 s; doc 13 §7 allows one
		// visible toast. Those agree only while this holds — a toast that outlived
		// its own throttle window could overlap the next one.
		expect(TOAST_MS).toBeLessThan(BACKOFF.toastThrottleMs);
	});
});
