import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF } from '$lib/shared-constants';
import { online } from '$lib/stores/online.svelte';
import { TpApiError } from './api';
import { nextMidnight, scheduler } from './scheduler';

/**
 * doc 19 §3.4, scheduler half: visibility pause/resume, drift-free scheduling,
 * overlap, backoff caps and jitter bounds, and — the one the DoD actually
 * hangs on — that unregister leaves nothing behind.
 *
 * Driven through `scheduler.tick(now)` rather than by stubbing setInterval, so
 * the tests exercise the same due-time arithmetic production uses.
 */

const HOUR = 3_600_000;

/** The node project has no document; visibility is read, never written. */
let hidden = false;

beforeEach(() => {
	hidden = false;
	vi.stubGlobal('document', {
		get visibilityState() {
			return hidden ? 'hidden' : 'visible';
		},
		addEventListener: () => {},
		removeEventListener: () => {}
	});
	online.reset();
});

afterEach(() => {
	scheduler.reset();
	online.reset();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('register and unregister', () => {
	it('runs once at registration by default', async () => {
		const run = vi.fn();

		scheduler.register('a', { cadence: { kind: 'interval', everyMs: 1000 }, run });
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

		expect(run.mock.calls[0]?.[0]).toMatchObject({ reason: 'register' });
	});

	it('honours runOnRegister: false', () => {
		const run = vi.fn();

		scheduler.register('a', {
			cadence: { kind: 'interval', everyMs: 1000 },
			run,
			runOnRegister: false
		});

		expect(run).not.toHaveBeenCalled();
	});

	it('removes the entry on unregister', () => {
		const handle = scheduler.register('a', {
			cadence: { kind: 'interval', everyMs: 1000 },
			run: () => {},
			runOnRegister: false
		});
		expect(scheduler.size).toBe(1);

		handle.unregister();

		expect(scheduler.size).toBe(0);
	});

	it('is idempotent, so a double teardown cannot drop someone else', () => {
		const first = scheduler.register('a', {
			cadence: { kind: 'interval', everyMs: 1000 },
			run: () => {},
			runOnRegister: false
		});
		const second = scheduler.register('a', {
			cadence: { kind: 'interval', everyMs: 1000 },
			run: () => {},
			runOnRegister: false
		});

		first.unregister();
		first.unregister();

		// The second holder is still there; a repeated release must not count.
		expect(scheduler.size).toBe(1);
		second.unregister();
		expect(scheduler.size).toBe(0);
	});

	it('refcounts a shared id so one data key means one fetch', async () => {
		const run = vi.fn();
		const second = vi.fn();

		scheduler.register('wx:v1:w3gvk', { cadence: { kind: 'interval', everyMs: 1000 }, run });
		scheduler.register('wx:v1:w3gvk', {
			cadence: { kind: 'interval', everyMs: 1000 },
			run: second
		});

		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
		// The first registration's options win; the second joins the schedule.
		expect(second).not.toHaveBeenCalled();
		expect(scheduler.size).toBe(1);
		expect(scheduler.inspect()[0]?.refs).toBe(2);
	});
});

describe('due times', () => {
	it('schedules from the last run rather than counting ticks', async () => {
		const run = vi.fn();
		vi.spyOn(Date, 'now').mockReturnValue(10_000);

		scheduler.register('a', { cadence: { kind: 'interval', everyMs: 5000 }, run });
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

		scheduler.tick(12_000); // not yet due
		expect(run).toHaveBeenCalledTimes(1);

		scheduler.tick(15_000); // exactly due
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
	});

	it('holds a manual cadence until asked', async () => {
		const run = vi.fn();
		const handle = scheduler.register('a', { cadence: { kind: 'manual' }, run });

		scheduler.tick(Date.now() + HOUR);
		expect(run).not.toHaveBeenCalled();

		await handle.runNow();
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('computes the next local midnight, not now plus 24 h', () => {
		const midday = new Date(2026, 7, 19, 12, 30, 15, 250).getTime();
		const next = new Date(nextMidnight(midday));

		expect(next.getDate()).toBe(20);
		expect(next.getHours()).toBe(0);
		expect(next.getMinutes()).toBe(0);
		expect(next.getSeconds()).toBe(0);
		expect(next.getMilliseconds()).toBe(0);
	});

	it('rolls a midnight cadence forward after it fires', async () => {
		const run = vi.fn();
		const justBefore = new Date(2026, 7, 19, 23, 59, 50).getTime();
		vi.spyOn(Date, 'now').mockReturnValue(justBefore);

		scheduler.register('cal', { cadence: { kind: 'midnight' }, run, runOnRegister: false });
		const firstDue = scheduler.inspect()[0]?.nextDueAt ?? 0;
		expect(new Date(firstDue).getDate()).toBe(20);

		vi.spyOn(Date, 'now').mockReturnValue(firstDue + 1);
		scheduler.tick(firstDue + 1);
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

		expect(new Date(scheduler.inspect()[0]?.nextDueAt ?? 0).getDate()).toBe(21);
	});
});

describe('overlap and visibility', () => {
	it('skips an entry that is still running rather than queueing', async () => {
		let release: () => void = () => {};
		const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
		vi.spyOn(Date, 'now').mockReturnValue(0);

		scheduler.register('a', { cadence: { kind: 'interval', everyMs: 1000 }, run });
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

		scheduler.tick(10_000);
		scheduler.tick(20_000);
		expect(run).toHaveBeenCalledTimes(1);

		release();
		await vi.waitFor(() => expect(scheduler.inspect()[0]?.state).not.toBe('running'));
	});

	it('does not tick at all while the tab is hidden', async () => {
		const run = vi.fn();
		scheduler.register('a', { cadence: { kind: 'interval', everyMs: 1000 }, run });
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

		hidden = true;
		scheduler.tick(Date.now() + HOUR);

		expect(run).toHaveBeenCalledTimes(1);
	});

	it('reports paused while hidden and idle once visible', async () => {
		scheduler.register('a', {
			cadence: { kind: 'interval', everyMs: 1000 },
			run: () => {},
			runOnRegister: false
		});

		hidden = true;
		expect(scheduler.inspect()[0]?.state).toBe('paused');
		hidden = false;
		expect(scheduler.inspect()[0]?.state).toBe('idle');
	});
});

describe('backoff', () => {
	it('stays inside the documented cap and jitter band', async () => {
		const run = vi.fn(() => Promise.reject(new Error('upstream down')));
		vi.spyOn(Date, 'now').mockReturnValue(0);

		scheduler.register('a', { cadence: { kind: 'interval', everyMs: 1000 }, run });
		await vi.waitFor(() => expect(scheduler.inspect()[0]?.consecutiveFailures).toBe(1));

		const firstDelay = scheduler.inspect()[0]?.nextDueAt ?? 0;
		// One failure: base 1 s, ±20 %.
		expect(firstDelay).toBeGreaterThanOrEqual(BACKOFF.baseMs * (1 - BACKOFF.jitterRatio));
		expect(firstDelay).toBeLessThanOrEqual(BACKOFF.baseMs * (1 + BACKOFF.jitterRatio));
	});

	it('never exceeds the cap however many times it fails', async () => {
		const run = vi.fn(() => Promise.reject(new Error('still down')));
		vi.spyOn(Date, 'now').mockReturnValue(0);
		const handle = scheduler.register('a', { cadence: { kind: 'interval', everyMs: 1 }, run });

		for (let i = 0; i < 20; i++) await handle.runNow();

		const due = scheduler.inspect()[0]?.nextDueAt ?? 0;
		expect(due).toBeLessThanOrEqual(BACKOFF.maxMs * (1 + BACKOFF.jitterRatio));
	});

	it('records the failure for the diagnostics table and clears it on success', async () => {
		let fail = true;
		const handle = scheduler.register('a', {
			cadence: { kind: 'interval', everyMs: 1000 },
			runOnRegister: false,
			run: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve())
		});

		await handle.runNow();
		expect(scheduler.inspect()[0]?.lastError).toBe('Error: boom');

		fail = false;
		await handle.runNow();
		const snapshot = scheduler.inspect()[0];
		expect(snapshot?.lastError).toBeUndefined();
		expect(snapshot?.consecutiveFailures).toBe(0);
	});
});

describe('online recovery', () => {
	it('runs due entries again when connectivity returns', async () => {
		const run = vi.fn();
		vi.spyOn(Date, 'now').mockReturnValue(0);
		scheduler.register('a', { cadence: { kind: 'interval', everyMs: 1000 }, run });
		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

		vi.spyOn(Date, 'now').mockReturnValue(50_000);
		online.noteFetchResult('network-error');
		online.noteFetchResult('network-error');
		expect(online.isOnline).toBe(false);

		online.noteFetchResult('ok');

		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
		expect(run.mock.calls[1]?.[0]).toMatchObject({ reason: 'online' });
	});
});

/**
 * doc 04 §2, doc 11 §7.3 and doc 17 §5 all describe a retry curve, and until
 * 2026-09-01 none of them described this module: `execute`'s `finally`
 * recomputed `nextDueAt` from the cadence on the failure path too, and
 * `effectiveDue` takes the later of the two — so every delay shorter than the
 * cadence was invisible. The cases below were each run against the unfixed
 * scheduler first and each failed there; the two in `describe('backoff')`
 * above did not, because a 1 s cadence happens to sit inside the band they
 * assert.
 */
describe('backoff actually governs the next run', () => {
	/** Longer than `BACKOFF.maxMs`, so *no* point on the curve could reach it. */
	const LONG_CADENCE = { kind: 'interval', everyMs: 600_000 } as const;

	it('retries on the curve rather than waiting out a long cadence', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(0);
		const run = vi.fn(() => Promise.reject(new Error('upstream down')));

		scheduler.register('a', { cadence: LONG_CADENCE, run });
		await vi.waitFor(() => expect(scheduler.inspect()[0]?.consecutiveFailures).toBe(1));

		const due = scheduler.inspect()[0]?.nextDueAt ?? 0;
		expect(due).toBeGreaterThanOrEqual(BACKOFF.baseMs * (1 - BACKOFF.jitterRatio));
		expect(due).toBeLessThanOrEqual(BACKOFF.baseMs * (1 + BACKOFF.jitterRatio));
	});

	it('respects a delay the server named, over the curve', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(0);
		const run = vi.fn(() =>
			Promise.reject(new TpApiError('RATE_LIMITED', 'RATE_LIMITED (HTTP 429)', { retryAfterS: 90 }))
		);

		scheduler.register('a', { cadence: LONG_CADENCE, run });
		await vi.waitFor(() => expect(scheduler.inspect()[0]?.consecutiveFailures).toBe(1));

		expect(scheduler.inspect()[0]?.nextDueAt).toBe(90_000);
	});

	it('does not cap a named delay at the curve ceiling', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(0);
		// doc 11 §6's quota trip holds to UTC midnight, which is hours rather
		// than the 300 s the exponential curve tops out at.
		const run = vi.fn(() =>
			Promise.reject(
				new TpApiError('QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED (HTTP 503)', { retryAfterS: 3600 })
			)
		);

		scheduler.register('a', { cadence: LONG_CADENCE, run });
		await vi.waitFor(() => expect(scheduler.inspect()[0]?.consecutiveFailures).toBe(1));

		expect(scheduler.inspect()[0]?.nextDueAt).toBe(3_600_000);
		expect(3_600_000).toBeGreaterThan(BACKOFF.maxMs);
	});

	it('falls back to the curve when the named delay is not a usable number', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(0);
		const run = vi.fn(() =>
			Promise.reject(new TpApiError('UPSTREAM_DOWN', 'nonsense', { retryAfterS: -5 }))
		);

		scheduler.register('a', { cadence: LONG_CADENCE, run });
		await vi.waitFor(() => expect(scheduler.inspect()[0]?.consecutiveFailures).toBe(1));

		const due = scheduler.inspect()[0]?.nextDueAt ?? 0;
		expect(due).toBeGreaterThanOrEqual(BACKOFF.baseMs * (1 - BACKOFF.jitterRatio));
		expect(due).toBeLessThanOrEqual(BACKOFF.baseMs * (1 + BACKOFF.jitterRatio));
	});

	it('returns to the cadence once a run succeeds', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(0);
		let fail = true;
		const handle = scheduler.register('a', {
			cadence: LONG_CADENCE,
			runOnRegister: false,
			run: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve())
		});

		await handle.runNow();
		expect(scheduler.inspect()[0]?.state).toBe('backoff');

		fail = false;
		await handle.runNow();

		// Back on the cadence, not left on whatever the backoff had set.
		expect(scheduler.inspect()[0]?.nextDueAt).toBe(600_000);
		expect(scheduler.inspect()[0]?.state).toBe('idle');
	});

	it('leaves a manual cadence unscheduled after a failure', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(0);
		const handle = scheduler.register('a', {
			cadence: { kind: 'manual' },
			runOnRegister: false,
			run: () => Promise.reject(new Error('boom'))
		});

		await handle.runNow();

		// `effectiveDue` falls through to `backoffUntil` when `nextDueAt` is null,
		// so a backoff written here would be the one thing that could make a
		// manual entry come due on a tick (doc 04 §3).
		expect(scheduler.inspect()[0]?.consecutiveFailures).toBe(1);
		expect(scheduler.inspect()[0]?.nextDueAt).toBeNull();
	});
});

/**
 * doc 06 §7's `visibleOnly` column, which `markets` is the first widget to set.
 *
 * Both cases were run against the pre-2026-09-01 scheduler: the first passed
 * for the wrong reason (the flag was checked inside `tick`, which has already
 * returned when the tab is hidden, so the condition was unreachable) and the
 * second failed.
 */
describe('visibleOnly (doc 06 §7)', () => {
	const marketsCadence = { kind: 'interval', everyMs: 60_000, visibleOnly: true } as const;

	it('does not tick a visible-only entry while the tab is hidden', async () => {
		const run = vi.fn();
		scheduler.register('a', { cadence: marketsCadence, run, runOnRegister: false });

		hidden = true;
		scheduler.tick(Date.now() + 120_000);

		expect(run).not.toHaveBeenCalled();
	});

	it('does not wake a visible-only entry when connectivity returns to a hidden tab', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(0);
		const background = vi.fn();
		const foreground = vi.fn();

		scheduler.register('markets', {
			cadence: marketsCadence,
			run: background,
			runOnRegister: false
		});
		scheduler.register('weather', {
			cadence: { kind: 'interval', everyMs: 60_000 },
			run: foreground,
			runOnRegister: false
		});

		// Both are due; the tab is in the background and the network comes back.
		vi.spyOn(Date, 'now').mockReturnValue(120_000);
		hidden = true;
		online.noteFetchResult('network-error');
		online.noteFetchResult('network-error');
		online.noteFetchResult('ok');

		// The ticker stops on `visibilitychange`, but the `online` subscription
		// does not — so this path is the one that could reach a hidden tab, and
		// it ran everything due regardless of the flag until 2026-09-01.
		await vi.waitFor(() => expect(foreground).toHaveBeenCalledTimes(1));
		expect(background).not.toHaveBeenCalled();
	});
});
