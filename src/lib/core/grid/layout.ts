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

/**
 * The `tp.layout.v1` spec (doc 05 §5). Lives here rather than in the deck
 * store so the shape and the thing that validates it stay in one file.
 *
 * The validator is hand-written per doc 05 §6 — no runtime schema dependency —
 * and is deliberately permissive about `widgetId`: a layout naming a widget
 * this build does not have is *valid*, not corrupt. Dropping those tiles is
 * the deck store's job, and quarantining the whole key over one of them would
 * throw away a working deck.
 */
export const LAYOUT_VERSION = 1;

function isTile(value: unknown): value is TpTile {
	if (typeof value !== 'object' || value === null) return false;
	const t = value as Record<string, unknown>;
	return (
		typeof t['instanceId'] === 'string' &&
		typeof t['widgetId'] === 'string' &&
		typeof t['x'] === 'number' &&
		typeof t['y'] === 'number' &&
		typeof t['w'] === 'number' &&
		typeof t['h'] === 'number' &&
		typeof t['settings'] === 'object' &&
		t['settings'] !== null
	);
}

export function isLayout(candidate: unknown): candidate is TpLayout {
	if (typeof candidate !== 'object' || candidate === null) return false;
	const l = candidate as Record<string, unknown>;
	return (
		l['schemaVersion'] === LAYOUT_VERSION && Array.isArray(l['grid']) && l['grid'].every(isTile)
	);
}
