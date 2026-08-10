import type { GridStackWidget } from 'gridstack';

/**
 * Layout serialisation for `tp.layout.v1` (doc 05 §2).
 *
 * gridstack's own `save()` output is deliberately not persisted: it carries
 * library-shaped fields that would couple the stored format to a gridstack
 * version. Everything here is TilePier's shape, converted at the boundary.
 */

export interface TpTile {
	/** nanoid-style; multiple instances of the same widget are allowed. */
	instanceId: string;
	/** Registry id (doc 06 §7). */
	widgetId: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/** Per-instance widget settings live here, not in Dexie (doc 05 §2). */
	settings: Record<string, unknown>;
}

export interface TpLayout {
	schemaVersion: 1;
	grid: TpTile[];
}

export const EMPTY_LAYOUT: TpLayout = { schemaVersion: 1, grid: [] };

/** Tile → the shape `grid.addWidget()` wants. */
export function toGridStackWidget(tile: TpTile): GridStackWidget {
	return { id: tile.instanceId, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
}

/**
 * Reads positions back off the live grid.
 *
 * Order is normalised by (y, x) rather than kept as gridstack reports it, so a
 * round-trip through serialise → rebuild → serialise is byte-stable. Without
 * that, node ordering after a rebuild differs from the original insertion
 * order and the comparison in the S1 harness fails for no real reason.
 */
export function serialise(nodes: GridStackWidget[], tiles: Map<string, TpTile>): TpLayout {
	const grid: TpTile[] = [];

	for (const node of nodes) {
		const id = node.id;
		if (typeof id !== 'string') continue;
		const tile = tiles.get(id);
		if (!tile) continue;

		grid.push({
			...tile,
			x: node.x ?? tile.x,
			y: node.y ?? tile.y,
			w: node.w ?? tile.w,
			h: node.h ?? tile.h
		});
	}

	grid.sort((a, b) => a.y - b.y || a.x - b.x || a.instanceId.localeCompare(b.instanceId));
	return { schemaVersion: 1, grid };
}
