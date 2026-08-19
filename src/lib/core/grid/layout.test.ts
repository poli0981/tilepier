import { describe, expect, it } from 'vitest';
import type { GridStackWidget } from 'gridstack';
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
		// ours should travel the other way either.
		expect(result).toEqual({ id: 'wgt_aaaa', x: 0, y: 0, w: 3, h: 2 });
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

	it('falls back to the stored position when a node omits one', () => {
		const stored = new Map([['a', tile({ instanceId: 'a', x: 9, y: 7, w: 2, h: 1 })]]);

		expect(serialise([{ id: 'a' }], stored).grid[0]).toMatchObject({ x: 9, y: 7, w: 2, h: 1 });
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
