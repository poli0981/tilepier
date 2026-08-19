import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLog } from '$lib/core/log-buffer';
import { LOCAL_KEYS } from '$lib/shared-constants';
import { LAYOUT_DEBOUNCE_MS, deck, seedDeck } from './deck.svelte';
import type { TpTile } from '$lib/core/grid/layout';

/**
 * Layout persistence (doc 05 §2/§5, doc 04 §6). Browser project: it needs real
 * localStorage, real timers driven by fake ones, and real `visibilitychange`.
 *
 * Storage is cleared between tests by `src/vitest-browser-setup.ts`.
 */

function store(tiles: Partial<TpTile>[]): void {
	localStorage.setItem(
		LOCAL_KEYS.layout,
		JSON.stringify({
			schemaVersion: 1,
			grid: tiles.map((tile, i) => ({
				instanceId: `wgt_seed${i}`,
				widgetId: 'clock',
				x: 0,
				y: 0,
				w: 3,
				h: 2,
				settings: {},
				...tile
			}))
		})
	);
}

function stored(): { grid: TpTile[] } | null {
	const raw = localStorage.getItem(LOCAL_KEYS.layout);
	return raw === null ? null : (JSON.parse(raw) as { grid: TpTile[] });
}

beforeEach(() => {
	deck.dispose();
});

afterEach(() => {
	deck.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('hydrate', () => {
	it('seeds a first-run deck from the registry', () => {
		deck.hydrate();

		// doc 13 §9's five-tile deck, filtered to what this build has.
		expect(deck.tiles.map((t) => t.widgetId)).toEqual(['clock']);
		expect(deck.loaded).toBe(true);
	});

	it('does not write on a clean first run', () => {
		deck.hydrate();

		// The seed is shown, not committed; the first real action persists it.
		expect(localStorage.getItem(LOCAL_KEYS.layout)).toBeNull();
	});

	it('restores a stored deck', () => {
		store([{ instanceId: 'wgt_aaaa', x: 6, y: 4 }]);

		deck.hydrate();

		expect(deck.tiles).toHaveLength(1);
		expect(deck.tiles[0]).toMatchObject({ instanceId: 'wgt_aaaa', x: 6, y: 4 });
	});

	it('is idempotent', () => {
		deck.hydrate();
		deck.add('clock');
		deck.hydrate();

		expect(deck.tiles).toHaveLength(2);
	});

	it('drops a tile whose widget this build does not have, warning once', () => {
		store([{ instanceId: 'wgt_keep' }, { instanceId: 'wgt_gone', widgetId: 'weather' }]);

		deck.hydrate();

		expect(deck.tiles.map((t) => t.instanceId)).toEqual(['wgt_keep']);
		const warnings = readLog().filter((e) => e.src === 'layout');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.msg).toContain('weather');
	});

	it('rewrites immediately after dropping, so the warning does not repeat', () => {
		store([{ instanceId: 'wgt_keep' }, { instanceId: 'wgt_gone', widgetId: 'markets' }]);

		deck.hydrate();

		// Not debounced: a pruned layout that is not written comes back next load.
		expect(stored()?.grid).toHaveLength(1);
	});

	it('treats an unknown widgetId as valid data, not corruption', () => {
		store([{ instanceId: 'wgt_gone', widgetId: 'rss' }]);

		deck.hydrate();

		// Quarantining the key over one future widget would throw away a deck.
		expect(Object.keys(localStorage).some((k) => k.startsWith('tp.corrupt.'))).toBe(false);
	});
});

describe('add', () => {
	it('places a new tile below everything already there', () => {
		store([{ instanceId: 'wgt_aaaa', y: 0, h: 2 }]);
		deck.hydrate();

		const tile = deck.add('clock');

		expect(tile).not.toBeNull();
		expect(tile?.y).toBe(2);
		expect(tile?.w).toBe(3); // the manifest default
	});

	it('returns the tile so the caller can hand it to gridstack', () => {
		deck.hydrate();

		const tile = deck.add('clock');

		// doc 06 §5 rule 9: the grid does not pick this up from the prop.
		expect(tile?.instanceId).toMatch(/^wgt_/);
		expect(deck.tiles.at(-1)?.instanceId).toBe(tile?.instanceId);
	});

	it('refuses an unknown widget', () => {
		deck.hydrate();

		expect(deck.add('markets')).toBeNull();
		expect(deck.tiles).toHaveLength(1);
	});

	it('allows a second clock, because the manifest is multiInstance', () => {
		deck.hydrate();

		expect(deck.add('clock')).not.toBeNull();
		expect(deck.tiles).toHaveLength(2);
	});
});

describe('remove and updateSettings', () => {
	it('removes by instanceId', () => {
		store([{ instanceId: 'wgt_aaaa' }, { instanceId: 'wgt_bbbb' }]);
		deck.hydrate();

		deck.remove('wgt_aaaa');

		expect(deck.tiles.map((t) => t.instanceId)).toEqual(['wgt_bbbb']);
	});

	it('merges a partial into one tile only', () => {
		store([{ instanceId: 'wgt_aaaa', settings: { clock24h: true } }, { instanceId: 'wgt_bbbb' }]);
		deck.hydrate();

		deck.updateSettings('wgt_aaaa', { showSeconds: true });

		expect(deck.tiles[0]?.settings).toEqual({ clock24h: true, showSeconds: true });
		expect(deck.tiles[1]?.settings).toEqual({});
	});
});

describe('the write debounce', () => {
	it('writes once after a burst settles', () => {
		vi.useFakeTimers();
		deck.hydrate();
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		for (let i = 0; i < 5; i++) {
			deck.applyLayout({ schemaVersion: 1, grid: [...deck.tiles] });
		}

		expect(setItem).not.toHaveBeenCalled();
		vi.advanceTimersByTime(LAYOUT_DEBOUNCE_MS);
		expect(setItem).toHaveBeenCalledTimes(1);
	});

	it('flushes immediately when the tab is hidden mid-window', () => {
		vi.useFakeTimers();
		deck.hydrate();
		deck.add('clock');
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		// The case the timer alone loses: drag a tile, switch tabs, come back.
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));

		expect(setItem).toHaveBeenCalledTimes(1);
		expect(stored()?.grid).toHaveLength(2);
	});
});

describe('reset', () => {
	it('restores the seed and writes at once', () => {
		store([{ instanceId: 'wgt_aaaa' }, { instanceId: 'wgt_bbbb' }, { instanceId: 'wgt_cccc' }]);
		deck.hydrate();

		deck.reset();

		expect(deck.tiles).toHaveLength(seedDeck().length);
		// No debounce: the user asked, and expects it to have happened.
		expect(stored()?.grid).toHaveLength(seedDeck().length);
	});
});
