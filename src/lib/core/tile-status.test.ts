import { afterEach, describe, expect, it } from 'vitest';
import { setTileStatus, tileStatus, tileStatusChannel, type TpTileStatus } from './tile-status';

/**
 * The channel's bookkeeping, in the node project — `SvelteMap` behaves as a
 * plain `Map` outside a reactive context, which is all this half needs.
 *
 * The *reactive* half is proven by `grid/TpWidgetHost.svelte.test.ts`, which
 * mounts a host and watches the badge appear. That split is the judgement
 * doc 19 §2 already makes for `core/grid/**`, and here it matters more than
 * usual: whether a plain `.ts` module can own a `SvelteMap` a component reads
 * reactively is the one assumption this design rests on.
 */

/** Widgets declare `retry` as a stable function; these stand in for one. */
const retryA = (): void => undefined;
const retryB = (): void => undefined;

function status(over: Partial<TpTileStatus> = {}): TpTileStatus {
	return { kind: 'stale', age: 'from 12 minutes ago', retry: null, ...over };
}

afterEach(() => tileStatusChannel.clear());

describe('publishing', () => {
	it('hands back exactly what was published', () => {
		const next = status();
		setTileStatus('wgt_a', next);
		expect(tileStatus('wgt_a')).toBe(next);
	});

	it('reports nothing for a tile that has nothing to say', () => {
		expect(tileStatus('wgt_never')).toBeUndefined();
	});

	it('keeps tiles apart', () => {
		setTileStatus('wgt_a', status({ kind: 'stale' }));
		setTileStatus('wgt_b', status({ kind: 'offline' }));

		expect(tileStatus('wgt_a')?.kind).toBe('stale');
		expect(tileStatus('wgt_b')?.kind).toBe('offline');
	});
});

describe('the identity guard', () => {
	it('does not replace an entry that says the same thing', () => {
		// The point of the guard: `retry` is a closure, and a widget that rebuilt
		// its status object every render would churn the map — and every host on
		// the deck derives off it.
		const first = status({ retry: retryA });
		setTileStatus('wgt_a', first);
		setTileStatus('wgt_a', status({ retry: retryA }));

		expect(tileStatus('wgt_a')).toBe(first);
	});

	it('replaces when the kind changes', () => {
		const first = status({ kind: 'stale' });
		setTileStatus('wgt_a', first);
		setTileStatus('wgt_a', status({ kind: 'stale-error' }));

		expect(tileStatus('wgt_a')).not.toBe(first);
		expect(tileStatus('wgt_a')?.kind).toBe('stale-error');
	});

	it('replaces when the age line moves on', () => {
		// The heartbeat case: the same staleness, a minute later.
		const first = status({ age: 'from 12 minutes ago' });
		setTileStatus('wgt_a', first);
		setTileStatus('wgt_a', status({ age: 'from 13 minutes ago' }));

		expect(tileStatus('wgt_a')?.age).toBe('from 13 minutes ago');
	});

	it('replaces when the retry becomes a different function', () => {
		const first = status({ retry: retryA });
		setTileStatus('wgt_a', first);
		setTileStatus('wgt_a', status({ retry: retryB }));

		expect(tileStatus('wgt_a')?.retry).toBe(retryB);
	});

	it('replaces when a retry appears where there was none', () => {
		setTileStatus('wgt_a', status({ retry: null }));
		setTileStatus('wgt_a', status({ retry: retryA }));

		expect(tileStatus('wgt_a')?.retry).toBe(retryA);
	});
});

describe('clearing', () => {
	it('drops the entry, and the tile with it', () => {
		// The leak assertion. A widget clears on unmount, so a channel that grew
		// with every tile ever mounted would be a leak nothing else could see —
		// the same discipline `swr`'s `release()` enforces.
		setTileStatus('wgt_a', status());
		expect(tileStatusChannel.size).toBe(1);

		setTileStatus('wgt_a', null);
		expect(tileStatus('wgt_a')).toBeUndefined();
		expect(tileStatusChannel.size).toBe(0);
	});

	it('is unbothered by clearing a tile that never published', () => {
		expect(() => setTileStatus('wgt_never', null)).not.toThrow();
		expect(tileStatusChannel.size).toBe(0);
	});

	it('empties wholesale for the next test', () => {
		setTileStatus('wgt_a', status());
		setTileStatus('wgt_b', status());
		expect(tileStatusChannel.size).toBe(2);

		tileStatusChannel.clear();
		expect(tileStatusChannel.size).toBe(0);
	});
});
