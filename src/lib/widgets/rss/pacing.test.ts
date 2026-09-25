import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPacer, type TpPacerOptions } from './pacing';

/**
 * Fake timers drive `Date.now` and `setTimeout` together, so every assertion
 * here is about when a turn is given, on a clock the test owns.
 */

beforeEach(() => {
	vi.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
	vi.useRealTimers();
});

const LOOSE: TpPacerOptions = { concurrency: 10, gapMs: 0, windows: [] };

/** Queues `count` waiters and records the clock time each is given its turn. */
function queue(
	pacer: ReturnType<typeof createPacer>,
	count: number,
	signal = new AbortController().signal
) {
	const given: number[] = [];
	const releases: (() => void)[] = [];
	const settled = Array.from({ length: count }, () =>
		pacer.acquire(signal).then((release) => {
			given.push(Date.now());
			releases.push(release);
		})
	);
	return { given, releases, settled };
}

describe('concurrency', () => {
	it('gives no more turns than it has, and the next when one comes back', async () => {
		const pacer = createPacer({ ...LOOSE, concurrency: 2 });
		const { given, releases } = queue(pacer, 3);

		await vi.advanceTimersByTimeAsync(0);
		expect(given).toHaveLength(2);

		releases[0]?.();
		await vi.advanceTimersByTimeAsync(0);
		expect(given).toHaveLength(3);
	});

	it('frees one turn however many times a release is called', async () => {
		const pacer = createPacer({ ...LOOSE, concurrency: 1 });
		const { given, releases } = queue(pacer, 3);

		await vi.advanceTimersByTimeAsync(0);
		releases[0]?.();
		releases[0]?.();
		await vi.advanceTimersByTimeAsync(0);

		expect(given).toHaveLength(2);
	});
});

describe('the gap between starts', () => {
	it('spaces starts by the gap even with turns to spare', async () => {
		const pacer = createPacer({ ...LOOSE, gapMs: 500 });
		const { given } = queue(pacer, 3);

		await vi.advanceTimersByTimeAsync(1_000);

		expect(given).toEqual([1_000_000, 1_000_500, 1_001_000]);
	});
});

describe('windows', () => {
	it('holds a start until the window has room for it', async () => {
		const pacer = createPacer({ ...LOOSE, windows: [{ limit: 2, ms: 10_000 }] });
		const { given, releases } = queue(pacer, 3);

		await vi.advanceTimersByTimeAsync(0);
		releases.forEach((release) => release());
		expect(given).toHaveLength(2);

		// Returning the turns frees concurrency, not the window.
		await vi.advanceTimersByTimeAsync(9_999);
		expect(given).toHaveLength(2);

		await vi.advanceTimersByTimeAsync(1);
		expect(given).toEqual([1_000_000, 1_000_000, 1_010_000]);
	});

	it('honours the tighter of two windows', async () => {
		// doc 11 §7's pair, scaled down: 3 per second and 4 per ten.
		const pacer = createPacer({
			...LOOSE,
			windows: [
				{ limit: 3, ms: 1_000 },
				{ limit: 4, ms: 10_000 }
			]
		});
		const { given, releases } = queue(pacer, 5);

		for (let step = 0; step < 12; step += 1) {
			await vi.advanceTimersByTimeAsync(1_000);
			releases.splice(0).forEach((release) => release());
		}

		expect(given.map((at) => at - 1_000_000)).toEqual([0, 0, 0, 1_000, 10_000]);
	});
});

describe('a 429', () => {
	it('holds every start for as long as it was told, and not the turns already out', async () => {
		const pacer = createPacer({ ...LOOSE, concurrency: 1 });
		const { given, releases } = queue(pacer, 2);

		await vi.advanceTimersByTimeAsync(0);
		pacer.pause(30_000);
		releases[0]?.();

		await vi.advanceTimersByTimeAsync(29_999);
		expect(given).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);
		expect(given).toHaveLength(2);
	});

	it('never shortens a pause that is already longer', async () => {
		const pacer = createPacer(LOOSE);
		pacer.pause(30_000);
		pacer.pause(5_000);
		const { given } = queue(pacer, 1);

		await vi.advanceTimersByTimeAsync(29_999);
		expect(given).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(given).toHaveLength(1);
	});
});

describe('abort', () => {
	it('drops a waiter whose feed nobody reads any more, with the signal’s reason', async () => {
		const pacer = createPacer({ ...LOOSE, concurrency: 1 });
		const first = queue(pacer, 1);
		const controller = new AbortController();
		const second = pacer.acquire(controller.signal);
		const third = queue(pacer, 1);

		await vi.advanceTimersByTimeAsync(0);
		controller.abort();

		await expect(second).rejects.toMatchObject({ name: 'AbortError' });

		// Its place goes to the next in line, not to nobody.
		first.releases[0]?.();
		await vi.advanceTimersByTimeAsync(0);
		expect(third.given).toHaveLength(1);
	});

	it('refuses an already-aborted signal without queueing it', async () => {
		const pacer = createPacer({ ...LOOSE, concurrency: 1 });
		const controller = new AbortController();
		controller.abort();

		await expect(pacer.acquire(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

		const { given } = queue(pacer, 1);
		await vi.advanceTimersByTimeAsync(0);
		expect(given).toHaveLength(1);
	});
});

describe('reset', () => {
	it('forgets the window, the pause and the turns out', async () => {
		const pacer = createPacer({ concurrency: 1, gapMs: 0, windows: [{ limit: 1, ms: 60_000 }] });
		queue(pacer, 1);
		pacer.pause(60_000);
		await vi.advanceTimersByTimeAsync(0);

		pacer.reset();
		const { given } = queue(pacer, 1);
		await vi.advanceTimersByTimeAsync(0);

		expect(given).toHaveLength(1);
	});
});
