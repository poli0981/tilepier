import { GridStackEngine, type GridStackNode, type GridStackPosition } from 'gridstack';

/**
 * Arranging a tile without dragging it (WCAG 2.1.1 and 2.5.7; doc 06 §5,
 * doc 13 §8). The dialog asks for one of eight steps; this module answers
 * where the tile would go, and whether the step would change anything at all.
 *
 * **Why a step is not just `y + 1`.** The grid runs gridstack's default
 * `'top'` mode, which floats every tile up into free space. A tile moved one
 * row down pushes the tile below it further down, and then both float back:
 * the move lands exactly where it started and gridstack fires no `change`.
 * `e2e/journey-2` records the same thing for a drag. So "down" asks for the
 * row under the nearest tile below, and "up" for the nearest tile above's own
 * row — after the float, the two have swapped.
 *
 * **Why a simulation rather than a rule.** Whether a step changes anything
 * depends on every other tile: a neighbour that cannot move, a size bound, a
 * one-column layout. gridstack answers that question for itself in
 * `moveNodeCheck`, by moving a copy in a cloned engine; this does the same, so
 * a button is disabled exactly when pressing it would leave the deck as it was.
 */

export type TpArrangeMove =
	'left' | 'right' | 'up' | 'down' | 'wider' | 'narrower' | 'taller' | 'shorter';

const ARRANGE_MOVES: readonly TpArrangeMove[] = [
	'left',
	'right',
	'up',
	'down',
	'wider',
	'narrower',
	'taller',
	'shorter'
];

export interface TpArrangeState {
	/** Zero-based, in the grid's current column count. */
	x: number;
	y: number;
	w: number;
	h: number;
	column: number;
	/** Whether each step would change the deck. */
	can: Record<TpArrangeMove, boolean>;
}

type Box = Required<GridStackPosition>;

/** A node's box with gridstack's own defaults filled in, once, so the rules
 *  below read as geometry rather than as a row of `?? 0`. */
function boxOf(node: GridStackNode): Box {
	return { x: node.x ?? 0, y: node.y ?? 0, w: node.w ?? 1, h: node.h ?? 1 };
}

function samePos(a: Box, b: Box): boolean {
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function overlapsColumns(a: Box, b: Box): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w;
}

/** The position a step asks for, before gridstack resolves collisions. */
function request(at: Box, others: readonly Box[], column: number, move: TpArrangeMove): Box | null {
	const { x, y, w, h } = at;
	switch (move) {
		case 'left':
			return x > 0 ? { x: x - 1, y, w, h } : null;
		case 'right':
			return x + w < column ? { x: x + 1, y, w, h } : null;
		case 'up': {
			// The nearest tile above that shares a column: take its row.
			const above = others
				.filter((other) => overlapsColumns(at, other) && other.y + other.h <= y)
				.sort((a, b) => b.y + b.h - (a.y + a.h))[0];
			return above === undefined ? null : { x, y: above.y, w, h };
		}
		case 'down': {
			// The nearest tile below that shares a column: go under it.
			const below = others
				.filter((other) => overlapsColumns(at, other) && other.y >= y + h)
				.sort((a, b) => a.y - b.y)[0];
			return below === undefined ? null : { x, y: below.y + below.h, w, h };
		}
		case 'wider':
			// Grows to the right, or to the left against the right edge.
			if (x + w < column) return { x, y, w: w + 1, h };
			return x > 0 ? { x: x - 1, y, w: w + 1, h } : null;
		case 'narrower':
			return w > 1 ? { x, y, w: w - 1, h } : null;
		case 'taller':
			return { x, y, w, h: h + 1 };
		case 'shorter':
			return h > 1 ? { x, y, w, h: h - 1 } : null;
	}
}

/**
 * The position to hand `grid.update()` for `move`, or null when the step would
 * leave every tile where it is. Runs the move on a clone, exactly as
 * `GridStack.update` → `moveNode` → `engine.moveNodeCheck` would.
 */
export function planArrange(
	engine: GridStackEngine,
	node: GridStackNode,
	move: TpArrangeMove
): Box | null {
	const index = engine.nodes.indexOf(node);
	const others = engine.nodes.filter((other) => other !== node).map(boxOf);
	const asked = index === -1 ? null : request(boxOf(node), others, engine.column, move);
	if (asked === null) return null;

	const twins = engine.nodes.map((other) => ({ ...other }));
	// `index` is a real position here, so the twin exists.
	const copy = twins[index] as GridStackNode;
	const clone = new GridStackEngine({ column: engine.column, mode: engine.mode, nodes: twins });

	// By identity, not position in the list: the engine sorts its node array in
	// place as it moves things, so index i is a different tile afterwards.
	const before = new Map(twins.map((twin) => [twin, boxOf(twin)]));
	// The same clamp `update()` applies first: the manifest's min/max sizes
	// (doc 06 §7) and the column count.
	const target: GridStackNode = { ...copy, ...asked };
	clone.nodeBoundFix(target);
	const position = boxOf(target);

	clone.beginUpdate(copy);
	clone.moveNodeCheck(copy, { ...position });
	clone.endUpdate();

	const changed = [...before].some(([twin, was]) => !samePos(was, boxOf(twin)));
	return changed ? position : null;
}

/** Where `node` is, and which steps are open to it. */
export function arrangeState(engine: GridStackEngine, node: GridStackNode): TpArrangeState {
	const can = Object.fromEntries(
		ARRANGE_MOVES.map((move) => [move, planArrange(engine, node, move) !== null])
	) as Record<TpArrangeMove, boolean>;
	return { ...boxOf(node), column: engine.column, can };
}
