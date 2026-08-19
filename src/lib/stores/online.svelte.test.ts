import { afterEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_TYPE_ERROR_STREAK, online } from './online.svelte';

/**
 * doc 17 §3. The heuristic is the point of this module: `navigator.onLine`
 * reports link state, not reachability, so a captive portal or a dead uplink
 * both read as online. Two consecutive fetch TypeErrors override it.
 *
 * Browser project because it needs real `window` events and `navigator`.
 */

afterEach(() => {
	online.reset();
	vi.restoreAllMocks();
});

describe('the TypeError heuristic', () => {
	it('starts online', () => {
		online.init();

		expect(online.isOnline).toBe(true);
	});

	it('needs two consecutive failures, not one', () => {
		online.init();

		online.noteFetchResult('network-error');
		expect(online.isOnline).toBe(true);

		online.noteFetchResult('network-error');
		expect(online.isOnline).toBe(false);
	});

	it('resets the streak on any success', () => {
		online.init();

		online.noteFetchResult('network-error');
		online.noteFetchResult('ok');
		online.noteFetchResult('network-error');

		expect(online.streak).toBe(1);
		expect(online.isOnline).toBe(true);
	});

	it('matches the documented threshold', () => {
		expect(OFFLINE_TYPE_ERROR_STREAK).toBe(2);
	});
});

describe('browser events', () => {
	it('goes offline on the offline event', () => {
		online.init();

		window.dispatchEvent(new Event('offline'));

		expect(online.isOnline).toBe(false);
	});

	it('clears a stale streak when the link comes back', () => {
		online.init();
		online.noteFetchResult('network-error');
		online.noteFetchResult('network-error');
		expect(online.isOnline).toBe(false);

		// The event is evidence the link returned, so the heuristic's suspicion
		// is out of date — otherwise the app would stay stuck offline.
		window.dispatchEvent(new Event('online'));

		expect(online.streak).toBe(0);
		expect(online.isOnline).toBe(true);
	});

	it('detaches its listeners', () => {
		const detach = online.init();
		detach();

		window.dispatchEvent(new Event('offline'));

		expect(online.isOnline).toBe(true);
	});
});

describe('subscribe', () => {
	it('fires only on a transition, not on every failure', () => {
		const seen = vi.fn();
		online.init();
		online.subscribe(seen);

		online.noteFetchResult('network-error'); // still online
		expect(seen).not.toHaveBeenCalled();

		online.noteFetchResult('network-error'); // crosses the threshold
		expect(seen).toHaveBeenCalledExactlyOnceWith(false);

		online.noteFetchResult('network-error'); // already offline
		expect(seen).toHaveBeenCalledTimes(1);

		online.noteFetchResult('ok');
		expect(seen).toHaveBeenCalledTimes(2);
		expect(seen).toHaveBeenLastCalledWith(true);
	});

	it('stops after unsubscribe', () => {
		const seen = vi.fn();
		online.init();
		online.subscribe(seen)();

		online.noteFetchResult('network-error');
		online.noteFetchResult('network-error');

		expect(seen).not.toHaveBeenCalled();
	});
});
