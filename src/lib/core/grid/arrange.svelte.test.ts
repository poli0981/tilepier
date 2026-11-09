import { describe, expect, it } from 'vitest';
import { GridStackEngine, type GridStackNode } from 'gridstack';
import { arrangeState, planArrange, type TpArrangeMove } from './arrange';

/**
 * The Arrange dialog's planner (doc 06 §5, doc 13 §8), against gridstack's own
 * engine rather than a model of it: the bug this module exists to avoid is a
 * step that gridstack quietly undoes, and only gridstack can say whether it
 * does. Browser project because the package's entry loads its drag-and-drop
 * half, which wants a document; the engine itself never touches one.
 */

type Box = { id: string; x: number; y: number; w: number; h: number } & Partial<GridStackNode>;

function engineOf(boxes: Box[], column = 12): GridStackEngine {
	const engine = new GridStackEngine({ column });
	for (const box of boxes) engine.addNode({ ...box });
	return engine;
}

function node(engine: GridStackEngine, id: string): GridStackNode {
	const found = engine.nodes.find((n) => n.id === id);
	if (found === undefined) throw new Error(`no node ${id}`);
	return found;
}

/** What `GridStack.update` does with the planned position. */
function apply(engine: GridStackEngine, id: string, move: TpArrangeMove): boolean {
	const target = node(engine, id);
	const position = planArrange(engine, target, move);
	if (position === null) return false;
	engine.beginUpdate(target);
	engine.moveNodeCheck(target, { ...position });
	engine.endUpdate();
	return true;
}

function at(
	engine: GridStackEngine,
	id: string
): { x: number | undefined; y: number | undefined; w: number | undefined; h: number | undefined } {
	const { x, y, w, h } = node(engine, id);
	return { x, y, w, h };
}

describe('moving', () => {
	it('steps one column right and left, and stops at the edges', () => {
		const engine = engineOf([{ id: 'a', x: 0, y: 0, w: 3, h: 2 }]);

		expect(arrangeState(engine, node(engine, 'a')).can.left).toBe(false);
		expect(apply(engine, 'a', 'right')).toBe(true);
		expect(at(engine, 'a').x).toBe(1);
		expect(apply(engine, 'a', 'left')).toBe(true);
		expect(at(engine, 'a').x).toBe(0);

		const far = engineOf([{ id: 'a', x: 9, y: 0, w: 3, h: 2 }]);
		expect(arrangeState(far, node(far, 'a')).can.right).toBe(false);
	});

	it('moves down by swapping with the tile below, which y + 1 never does', () => {
		// The trap the module is written around: in gridstack's 'top' mode a tile
		// asked one row down pushes the one below and both float back, so the
		// deck ends where it began. Asked to go under the tile below, it swaps.
		const engine = engineOf([
			{ id: 'a', x: 0, y: 0, w: 3, h: 2 },
			{ id: 'b', x: 0, y: 2, w: 3, h: 2 }
		]);

		const naive = node(engine, 'a');
		engine.beginUpdate(naive);
		engine.moveNodeCheck(naive, { x: 0, y: 1, w: 3, h: 2 });
		engine.endUpdate();
		expect(at(engine, 'a').y).toBe(0);

		expect(apply(engine, 'a', 'down')).toBe(true);
		expect(at(engine, 'a').y).toBe(2);
		expect(at(engine, 'b').y).toBe(0);
	});

	it('moves up by taking the row of the tile above', () => {
		const engine = engineOf([
			{ id: 'a', x: 0, y: 0, w: 3, h: 2 },
			{ id: 'b', x: 0, y: 2, w: 3, h: 3 }
		]);

		expect(apply(engine, 'b', 'up')).toBe(true);
		expect(at(engine, 'b').y).toBe(0);
		expect(at(engine, 'a').y).toBe(3);
	});

	it('offers no step that would leave every tile where it is', () => {
		// Alone at the top of its column, a tile can go neither up nor down.
		const engine = engineOf([
			{ id: 'a', x: 0, y: 0, w: 3, h: 2 },
			{ id: 'b', x: 6, y: 0, w: 3, h: 2 }
		]);
		const can = arrangeState(engine, node(engine, 'a')).can;

		expect(can.up).toBe(false);
		expect(can.down).toBe(false);
		expect(apply(engine, 'a', 'down')).toBe(false);
	});
});

describe('resizing', () => {
	it('keeps to the manifest bounds, as a drag does (doc 06 §7)', () => {
		const engine = engineOf([
			{ id: 'a', x: 0, y: 0, w: 3, h: 2, minW: 2, maxW: 4, minH: 2, maxH: 3 }
		]);

		expect(apply(engine, 'a', 'wider')).toBe(true);
		expect(at(engine, 'a').w).toBe(4);
		expect(arrangeState(engine, node(engine, 'a')).can.wider).toBe(false);

		expect(apply(engine, 'a', 'taller')).toBe(true);
		expect(at(engine, 'a').h).toBe(3);
		expect(arrangeState(engine, node(engine, 'a')).can.taller).toBe(false);

		expect(apply(engine, 'a', 'narrower')).toBe(true);
		expect(apply(engine, 'a', 'narrower')).toBe(true);
		expect(at(engine, 'a').w).toBe(2);
		expect(arrangeState(engine, node(engine, 'a')).can.narrower).toBe(false);

		expect(apply(engine, 'a', 'shorter')).toBe(true);
		expect(at(engine, 'a').h).toBe(2);
		expect(apply(engine, 'a', 'shorter')).toBe(false);
	});

	it('grows to the left against the right edge', () => {
		const engine = engineOf([{ id: 'a', x: 9, y: 0, w: 3, h: 2, maxW: 6 }]);

		expect(apply(engine, 'a', 'wider')).toBe(true);
		expect(at(engine, 'a')).toEqual({ x: 8, y: 0, w: 4, h: 2 });
	});
});

describe('one column (below 480 px, doc 06 §5.4)', () => {
	it('has no sideways step and no width to change, and still reorders', () => {
		const engine = engineOf(
			[
				{ id: 'a', x: 0, y: 0, w: 1, h: 2 },
				{ id: 'b', x: 0, y: 2, w: 1, h: 2 }
			],
			1
		);
		const can = arrangeState(engine, node(engine, 'a')).can;

		expect(can.left).toBe(false);
		expect(can.right).toBe(false);
		expect(can.wider).toBe(false);
		expect(can.narrower).toBe(false);

		expect(apply(engine, 'a', 'down')).toBe(true);
		expect(engine.nodes).toHaveLength(2);
		expect(at(engine, 'b').y).toBe(0);
	});
});

describe('the state it reports', () => {
	it('is zero-based and carries the column count, for the dialog to say', () => {
		const engine = engineOf([{ id: 'a', x: 2, y: 0, w: 3, h: 2 }], 6);
		const state = arrangeState(engine, node(engine, 'a'));

		expect(state).toMatchObject({ x: 2, y: 0, w: 3, h: 2, column: 6 });
	});
});

describe('the edges of every step', () => {
	it('offers nothing to a tile that fills the row, is one cell wide or one row tall', () => {
		const full = engineOf([{ id: 'a', x: 0, y: 0, w: 12, h: 1 }]);
		const fullCan = arrangeState(full, node(full, 'a')).can;
		// Neither edge has room: wider has nowhere to grow, sideways nowhere to go.
		expect(fullCan.wider).toBe(false);
		expect(fullCan.left).toBe(false);
		expect(fullCan.right).toBe(false);
		expect(fullCan.shorter).toBe(false);

		const thin = engineOf([{ id: 'a', x: 4, y: 0, w: 1, h: 2 }]);
		expect(arrangeState(thin, node(thin, 'a')).can.narrower).toBe(false);
	});

	it('answers a tile the engine does not hold with its place and no step at all', () => {
		// A wrapper TpGrid has already let go of: the dialog must show nothing it
		// could press, rather than plan against a tile that is not on the grid.
		const engine = engineOf([{ id: 'a', x: 0, y: 0, w: 3, h: 2 }]);
		const stranger: GridStackNode = {};

		const state = arrangeState(engine, stranger);

		expect(state).toMatchObject({ x: 0, y: 0, w: 1, h: 1, column: 12 });
		expect(Object.values(state.can).some(Boolean)).toBe(false);
	});
});

describe('choosing the neighbour', () => {
	it('swaps with the nearest tile, not the furthest, in a column of three', () => {
		const engine = engineOf([
			{ id: 'a', x: 0, y: 0, w: 3, h: 2 },
			{ id: 'b', x: 0, y: 2, w: 3, h: 2 },
			{ id: 'c', x: 0, y: 4, w: 3, h: 2 }
		]);

		expect(apply(engine, 'b', 'down')).toBe(true);
		expect([at(engine, 'a').y, at(engine, 'c').y, at(engine, 'b').y]).toEqual([0, 2, 4]);

		expect(apply(engine, 'b', 'up')).toBe(true);
		expect([at(engine, 'a').y, at(engine, 'b').y, at(engine, 'c').y]).toEqual([0, 2, 4]);

		// From the top, with two below: under the nearer one only.
		expect(apply(engine, 'a', 'down')).toBe(true);
		expect([at(engine, 'b').y, at(engine, 'a').y, at(engine, 'c').y]).toEqual([0, 2, 4]);
	});
});
