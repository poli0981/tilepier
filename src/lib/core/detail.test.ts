import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import { forgetDetailComponent, isDetailState, loadDetailComponent } from './detail';
import type { TpWidgetManifest } from './registry';
import type { TpDetailProps } from './types';

/**
 * doc 06 §6. The history half of the handshake belongs to SvelteKit's
 * `pushState` and is exercised by the overlay's component test and journey #2;
 * what is checked here is the half that is pure — the guard over restored
 * history state, and the chunk cache.
 */

/** Stands in for a real component. Nothing here renders it, so its identity is
 *  all that matters — which is exactly what the cache assertions compare. */
const STUB = (() => {}) as unknown as Component<TpDetailProps>;

function manifestWith(loadDetail?: () => Promise<{ default: Component<TpDetailProps> }>) {
	const manifest = {
		id: 'clock',
		i18nKey: 'widget.clock',
		category: 'time',
		icon: 'clock',
		sizes: { min: { w: 2, h: 1 }, max: { w: 6, h: 3 }, default: { w: 3, h: 2 } },
		multiInstance: true,
		loadWidget: () => Promise.reject(new Error('not used')),
		...(loadDetail === undefined ? {} : { loadDetail })
	} as TpWidgetManifest;

	return () => manifest;
}

/** Ids are namespaced per test so one case's cache entry cannot answer the
 *  next one's question — the cache is module-level by design. */
let counter = 0;
const freshId = () => `probe-${counter++}`;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('isDetailState', () => {
	it('accepts a state with a rect', () => {
		expect(
			isDetailState({
				instanceId: 'wgt_abc',
				widgetId: 'clock',
				rect: { x: 10, y: 20, width: 300, height: 200 }
			})
		).toBe(true);
	});

	it('accepts a state without one — a deep link has no tile to measure', () => {
		expect(isDetailState({ instanceId: 'wgt_abc', widgetId: 'clock' })).toBe(true);
	});

	it('rejects anything that is not an object', () => {
		expect(isDetailState(null)).toBe(false);
		expect(isDetailState(undefined)).toBe(false);
		expect(isDetailState('clock')).toBe(false);
		expect(isDetailState(42)).toBe(false);
	});

	it('rejects a widgetId this build does not know', () => {
		// A history entry written by a build that had a widget this one does not
		// is the same problem doc 05 §5 solves for the layout key: degrade, never
		// trust.
		expect(isDetailState({ instanceId: 'wgt_abc', widgetId: 'nonsense' })).toBe(false);
	});

	it('rejects a missing or non-string instanceId', () => {
		expect(isDetailState({ widgetId: 'clock' })).toBe(false);
		expect(isDetailState({ instanceId: 7, widgetId: 'clock' })).toBe(false);
	});

	it('rejects a rect that is present but malformed', () => {
		const base = { instanceId: 'wgt_abc', widgetId: 'clock' };
		expect(isDetailState({ ...base, rect: null })).toBe(false);
		expect(isDetailState({ ...base, rect: 'big' })).toBe(false);
		expect(isDetailState({ ...base, rect: { x: 1, y: 2, width: 3 } })).toBe(false);
		expect(isDetailState({ ...base, rect: { x: '1', y: 2, width: 3, height: 4 } })).toBe(false);
	});
});

describe('loadDetailComponent', () => {
	it('resolves null for a widget this build does not have', async () => {
		await expect(loadDetailComponent(freshId(), () => undefined)).resolves.toBeNull();
	});

	it('resolves null for a widget that declares no detail', async () => {
		// doc 06 §1 makes loadDetail optional; the tile simply does not open.
		await expect(loadDetailComponent(freshId(), manifestWith())).resolves.toBeNull();
	});

	it('resolves the component the thunk returns', async () => {
		const lookup = manifestWith(() => Promise.resolve({ default: STUB }));
		await expect(loadDetailComponent(freshId(), lookup)).resolves.toBe(STUB);
	});

	it('imports once however many times it is asked', async () => {
		// Two tiles of the same widget opened together share one round trip —
		// the de-dupe rule doc 04 §2 puts on swr(), for the same reason.
		const thunk = vi.fn(() => Promise.resolve({ default: STUB }));
		const id = freshId();
		const lookup = manifestWith(thunk);

		const [first, second] = await Promise.all([
			loadDetailComponent(id, lookup),
			loadDetailComponent(id, lookup)
		]);

		expect(thunk).toHaveBeenCalledTimes(1);
		expect(first).toBe(second);
	});

	it('keeps serving a resolved chunk after it settles', async () => {
		const thunk = vi.fn(() => Promise.resolve({ default: STUB }));
		const id = freshId();
		const lookup = manifestWith(thunk);

		await loadDetailComponent(id, lookup);
		await loadDetailComponent(id, lookup);

		expect(thunk).toHaveBeenCalledTimes(1);
	});

	it('remembers a failure instead of retrying on every click', async () => {
		// A chunk that failed has almost certainly failed for a reason still true
		// a second later; retrying per click turns one bad deploy into a storm.
		const thunk = vi.fn(() => Promise.reject(new Error('offline')));
		const id = freshId();
		const lookup = manifestWith(thunk);

		await expect(loadDetailComponent(id, lookup)).rejects.toThrow('offline');
		await expect(loadDetailComponent(id, lookup)).rejects.toThrow('offline');

		expect(thunk).toHaveBeenCalledTimes(1);
	});

	it('retries once the failure is forgotten', async () => {
		const thunk = vi
			.fn<() => Promise<{ default: Component<TpDetailProps> }>>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce({ default: STUB });
		const id = freshId();
		const lookup = manifestWith(thunk);

		await expect(loadDetailComponent(id, lookup)).rejects.toThrow('offline');
		forgetDetailComponent(id);

		await expect(loadDetailComponent(id, lookup)).resolves.toBe(STUB);
		expect(thunk).toHaveBeenCalledTimes(2);
	});
});
