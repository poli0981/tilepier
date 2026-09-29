import { describe, expect, it } from 'vitest';
import { windowOf } from './windowing';

describe('windowOf (doc 20 §7)', () => {
	it('renders the rows in view and a margin either side', () => {
		// 44 px rows, a 440 px viewport scrolled 100 rows down.
		const view = windowOf(4400, 440, 44, 10_000, 8);

		expect(view).toEqual({ start: 92, end: 118, before: 92 * 44, after: (10_000 - 118) * 44 });
	});

	it('keeps the spacers and rows adding up to the whole list', () => {
		for (const scrollTop of [0, 1, 999, 44_000, 439_999]) {
			const view = windowOf(scrollTop, 440, 44, 10_000);
			expect(view.before + (view.end - view.start) * 44 + view.after).toBe(10_000 * 44);
		}
	});

	it('starts at the top, and stops at the end of a short list', () => {
		expect(windowOf(0, 440, 44, 5)).toEqual({ start: 0, end: 5, before: 0, after: 0 });
		expect(windowOf(0, 440, 44, 1000).start).toBe(0);
	});

	it('does not run past the end when scrolled beyond it', () => {
		const view = windowOf(1_000_000, 440, 44, 50);

		expect(view.end).toBe(50);
		expect(view.start).toBeLessThanOrEqual(view.end);
		expect(view.after).toBe(0);
	});

	it('renders nothing for an empty list or a nonsense row height', () => {
		const none = { start: 0, end: 0, before: 0, after: 0 };
		expect(windowOf(0, 440, 44, 0)).toEqual(none);
		expect(windowOf(0, 440, 0, 10)).toEqual(none);
		expect(windowOf(0, 440, Number.NaN, 10)).toEqual(none);
	});

	it('reads a nonsense scroll or viewport as zero', () => {
		expect(windowOf(Number.NaN, Number.NaN, 44, 100, 0)).toEqual({
			start: 0,
			end: 0,
			before: 0,
			after: 100 * 44
		});
		expect(windowOf(-50, 88, 44, 100, 0)).toMatchObject({ start: 0, end: 2 });
	});
});
