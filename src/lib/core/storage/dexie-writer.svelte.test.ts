import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDexieWriter, type TpDexieWriter } from './dexie-writer';

/**
 * doc 04 §6's debounce for user-data writes.
 *
 * Browser project — the `.svelte.` infix selects it (doc 19 §1) — because the
 * behaviour that matters most is the pair of listeners it attaches to
 * `document` and `window`. A node test could check the timer and would miss
 * the whole reason this exists.
 */

const writers: TpDexieWriter<string>[] = [];

function writer(
	write: (value: string) => Promise<unknown>,
	onError?: (error: unknown) => void,
	delayMs = 20
): TpDexieWriter<string> {
	const made = createDexieWriter(write, onError, delayMs);
	writers.push(made);
	return made;
}

afterEach(() => {
	while (writers.length > 0) writers.pop()?.dispose();
	vi.restoreAllMocks();
});

function settle(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('debouncing', () => {
	it('writes once for a burst, with the last value', async () => {
		// Keystroke-level edits: the point is that typing five characters is one
		// write, not five.
		const write = vi.fn(() => Promise.resolve());
		const subject = writer(write);

		subject.schedule('a');
		subject.schedule('ab');
		subject.schedule('abc');
		await settle(60);

		expect(write).toHaveBeenCalledExactlyOnceWith('abc');
	});

	it('writes again for a burst after the window closes', async () => {
		const write = vi.fn(() => Promise.resolve());
		const subject = writer(write);

		subject.schedule('one');
		await settle(60);
		subject.schedule('two');
		await settle(60);

		expect(write).toHaveBeenCalledTimes(2);
		expect(write).toHaveBeenLastCalledWith('two');
	});

	it('does nothing at all when nothing was scheduled', async () => {
		const write = vi.fn(() => Promise.resolve());
		writer(write).flush();
		await settle(40);

		expect(write).not.toHaveBeenCalled();
	});
});

describe('flushing', () => {
	it('writes immediately rather than waiting out the window', async () => {
		const write = vi.fn(() => Promise.resolve());
		const subject = writer(write, undefined, 10_000);

		subject.schedule('now');
		subject.flush();

		expect(write).toHaveBeenCalledExactlyOnceWith('now');
	});

	it('flushes when the tab hides', () => {
		// doc 04 §6 names this explicitly, and it is the case a timer alone
		// loses: type a sentence, switch tabs mid-word.
		const write = vi.fn(() => Promise.resolve());
		const subject = writer(write, undefined, 10_000);
		subject.schedule('switching away');

		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));

		expect(write).toHaveBeenCalledExactlyOnceWith('switching away');
	});

	it('does not flush when the tab merely becomes visible', () => {
		const write = vi.fn(() => Promise.resolve());
		const subject = writer(write, undefined, 10_000);
		subject.schedule('still typing');

		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange'));

		expect(write).not.toHaveBeenCalled();
	});

	it('flushes on pagehide', () => {
		// The last moment a closing tab reliably gets.
		const write = vi.fn(() => Promise.resolve());
		const subject = writer(write, undefined, 10_000);
		subject.schedule('closing');

		window.dispatchEvent(new Event('pagehide'));

		expect(write).toHaveBeenCalledExactlyOnceWith('closing');
	});

	it('writes only once even if both events fire', () => {
		// A closing tab hides and then pagehides; the pending value is consumed
		// by whichever arrives first.
		const write = vi.fn(() => Promise.resolve());
		const subject = writer(write, undefined, 10_000);
		subject.schedule('once');

		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('pagehide'));

		expect(write).toHaveBeenCalledTimes(1);
	});
});

describe('disposal', () => {
	it('flushes what was pending', () => {
		const write = vi.fn(() => Promise.resolve());
		const subject = createDexieWriter(write, undefined, 10_000);

		subject.schedule('last words');
		subject.dispose();

		expect(write).toHaveBeenCalledExactlyOnceWith('last words');
	});

	it('stops listening, so a disposed writer cannot write again', () => {
		const write = vi.fn(() => Promise.resolve());
		const subject = createDexieWriter(write, undefined, 10_000);

		subject.dispose();
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('pagehide'));

		expect(write).not.toHaveBeenCalled();
	});
});

describe('failure', () => {
	it('reports a rejected write instead of leaving an unhandled rejection', async () => {
		// The write is fire-and-forget by design — `flush` runs from a pagehide
		// handler — so the only way a failure surfaces is this callback.
		const onError = vi.fn();
		const subject = writer(() => Promise.reject(new Error('quota')), onError);

		subject.schedule('doomed');
		await settle(60);

		expect(onError).toHaveBeenCalledTimes(1);
		expect((onError.mock.calls[0]?.[0] as Error).message).toBe('quota');
	});

	it('survives a failure without a handler', async () => {
		const subject = writer(() => Promise.reject(new Error('quota')));
		subject.schedule('doomed');
		await settle(60);

		// Nothing to assert but the absence of a crash; reaching here is the test.
		expect(true).toBe(true);
	});
});
