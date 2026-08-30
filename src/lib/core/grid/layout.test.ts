import { describe, expect, it } from 'vitest';
import type { GridStackWidget } from 'gridstack';
import { MANIFESTS } from '$lib/core/registry';
import { isLayout, serialise, toGridStackWidget, type TpTile } from './layout';

function tile(overrides: Partial<TpTile> = {}): TpTile {
	return {
		instanceId: 'wgt_aaaa',
		widgetId: 'clock',
		x: 0,
		y: 0,
		w: 3,
		h: 2,
		settings: {},
		...overrides
	};
}

describe('toGridStackWidget', () => {
	it('carries only what gridstack owns', () => {
		const result = toGridStackWidget(tile({ settings: { clock24h: true } }));

		// gridstack's own save() shape is deliberately not persisted; nothing of
		// ours should travel the other way either — `settings` least of all, and
		// the bounds below are gridstack's own fields rather than ours.
		expect(result).toEqual({
			id: 'wgt_aaaa',
			x: 0,
			y: 0,
			w: 3,
			h: 2,
			minW: 2,
			minH: 1,
			maxW: 6,
			maxH: 3
		});
	});

	it('emits every registered manifest’s size bounds', () => {
		// The numbers themselves are pinned to doc 06 §7 by `core/registry.test`.
		// What this asserts is the half that was missing until 2026-08-31: that
		// they reach gridstack at all. Restating the table here would test the
		// same thing twice and enforce it once.
		expect(MANIFESTS.length).toBeGreaterThan(0);

		for (const manifest of MANIFESTS) {
			expect(toGridStackWidget(tile({ widgetId: manifest.id })), manifest.id).toMatchObject({
				minW: manifest.sizes.min.w,
				minH: manifest.sizes.min.h,
				maxW: manifest.sizes.max.w,
				maxH: manifest.sizes.max.h
			});
		}
	});

	it('reads the bounds from the manifest, not from the tile’s current size', () => {
		// A tile someone had already dragged down to 1×1 still arrives carrying
		// the manifest's minimum — which is what makes gridstack's nodeBoundFix
		// clamp it back on load rather than accept it.
		expect(toGridStackWidget(tile({ w: 1, h: 1 }))).toMatchObject({
			w: 1,
			h: 1,
			minW: 2,
			minH: 1
		});
	});

	it('leaves a widget this build does not have unbounded', () => {
		// doc 05 §5: a layout naming an unbuilt or removed widget is valid data,
		// and the deck store drops those tiles. Inventing a limit for one the
		// registry cannot describe would be worse than having none.
		const result = toGridStackWidget(tile({ widgetId: 'rss' }));

		expect(result).toEqual({ id: 'wgt_aaaa', x: 0, y: 0, w: 3, h: 2 });
		expect(Object.keys(result)).not.toContain('minW');
	});
});

describe('serialise', () => {
	const tiles = new Map<string, TpTile>([
		['a', tile({ instanceId: 'a' })],
		['b', tile({ instanceId: 'b' })]
	]);

	it('takes positions from the live grid, not the stored tile', () => {
		const nodes: GridStackWidget[] = [{ id: 'a', x: 6, y: 4, w: 4, h: 3 }];

		expect(serialise(nodes, tiles).grid[0]).toMatchObject({ x: 6, y: 4, w: 4, h: 3 });
	});

	it('keeps per-instance settings, which gridstack knows nothing about', () => {
		const withSettings = new Map([
			['a', tile({ instanceId: 'a', settings: { zone: 'Asia/Tokyo' } })]
		]);

		expect(serialise([{ id: 'a', x: 0, y: 0 }], withSettings).grid[0]?.settings).toEqual({
			zone: 'Asia/Tokyo'
		});
	});

	it('falls back to the stored x and y when a node omits them', () => {
		const stored = new Map([['a', tile({ instanceId: 'a', x: 9, y: 7 })]]);

		expect(serialise([{ id: 'a' }], stored).grid[0]).toMatchObject({ x: 9, y: 7 });
	});

	it('reads an omitted w or h as the manifest minimum, not as the stored size', () => {
		// `grid.save()` runs its output through `Utils.removeInternalForSave`,
		// which drops `w` when it equals 1 *or* `minW` — the value is re-created
		// from the bounds on read. Falling back to the stored tile here would
		// mean a clock dragged exactly to its 2×1 minimum kept whatever size it
		// had before, because `tileById` is never written on a resize.
		const stored = new Map([['a', tile({ instanceId: 'a', w: 4, h: 3 })]]);

		expect(serialise([{ id: 'a', x: 0, y: 0 }], stored).grid[0]).toMatchObject({ w: 2, h: 1 });
	});

	it('reads an omitted w or h as 1 for a widget this build does not have', () => {
		// No manifest, no bounds — so gridstack only omits the field when it
		// really is 1, and that is what it means.
		const stored = new Map([['a', tile({ instanceId: 'a', widgetId: 'rss', w: 4, h: 3 })]]);

		expect(serialise([{ id: 'a', x: 0, y: 0 }], stored).grid[0]).toMatchObject({ w: 1, h: 1 });
	});

	it('sorts by row, then column, then id, so a round trip is byte-stable', () => {
		const nodes: GridStackWidget[] = [
			{ id: 'b', x: 0, y: 3 },
			{ id: 'a', x: 6, y: 0 }
		];

		// Without this, node order after a rebuild differs from insertion order
		// and a serialise → rebuild → serialise comparison fails for no reason.
		expect(serialise(nodes, tiles).grid.map((t) => t.instanceId)).toEqual(['a', 'b']);
	});

	it('drops a node with no matching tile rather than inventing one', () => {
		expect(serialise([{ id: 'ghost', x: 0, y: 0 }], tiles).grid).toEqual([]);
	});

	it('drops a node whose id is not a string', () => {
		expect(serialise([{ x: 0, y: 0 }], tiles).grid).toEqual([]);
	});
});

describe('isLayout', () => {
	it('accepts a well-formed layout', () => {
		expect(isLayout({ schemaVersion: 1, grid: [tile()] })).toBe(true);
		expect(isLayout({ schemaVersion: 1, grid: [] })).toBe(true);
	});

	it('accepts a widgetId this build does not have', () => {
		// doc 05 §5: that is valid data, not corruption. Rejecting it here would
		// quarantine a whole working deck over one future widget.
		expect(isLayout({ schemaVersion: 1, grid: [tile({ widgetId: 'nonsense' })] })).toBe(true);
	});

	it('rejects a wrong version, a missing grid, or a malformed tile', () => {
		expect(isLayout({ schemaVersion: 2, grid: [] })).toBe(false);
		expect(isLayout({ schemaVersion: 1 })).toBe(false);
		expect(isLayout({ schemaVersion: 1, grid: [{ instanceId: 'a' }] })).toBe(false);
		expect(isLayout({ schemaVersion: 1, grid: [{ ...tile(), settings: null }] })).toBe(false);
		expect(isLayout(null)).toBe(false);
		expect(isLayout('nope')).toBe(false);
	});
});
