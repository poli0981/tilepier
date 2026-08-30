import type { GridStackWidget } from 'gridstack';
import { getManifest } from '$lib/core/registry';

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

/**
 * Tile → the shape `grid.addWidget()` wants, size bounds included.
 *
 * The bounds are the manifest's `sizes.min` / `sizes.max` (doc 06 §7), read
 * here rather than at the call sites because this is the one boundary every
 * tile crosses on its way into the grid — `setup()`, `addTile()` and
 * `rebuild()` all go through it. gridstack spends them twice: `nodeBoundFix`
 * clamps a stored size on the way in, and `resizestart` turns them into the
 * pixel limits of the drag itself.
 *
 * Until 2026-08-31 this returned position and size alone, so every manifest's
 * limits were enforced nowhere and any tile could be drag-resized to 1×1 —
 * 112×48 px with rule 12's inset honoured, which no widget has a rendering
 * for. `core/registry.test.ts` asserted the numbers matched doc 06 §7's table
 * and nothing asserted they were applied: a contract that reads as wired and
 * is not (doc 06 §5 rule 14).
 *
 * A widgetId with no manifest stays unbounded, deliberately. doc 05 §5 says a
 * layout naming a widget this build does not have is valid data rather than
 * corruption, and dropping those tiles is the deck store's job — inventing a
 * limit for one the registry cannot describe would be worse than none.
 */
export function toGridStackWidget(tile: TpTile): GridStackWidget {
	const node: GridStackWidget = { id: tile.instanceId, x: tile.x, y: tile.y, w: tile.w, h: tile.h };
	const sizes = getManifest(tile.widgetId)?.sizes;
	if (sizes === undefined) return node;

	return {
		...node,
		minW: sizes.min.w,
		minH: sizes.min.h,
		maxW: sizes.max.w,
		maxH: sizes.max.h
	};
}

/**
 * Reads positions back off the live grid.
 *
 * Order is normalised by (y, x) rather than kept as gridstack reports it, so a
 * round-trip through serialise → rebuild → serialise is byte-stable. Without
 * that, node ordering after a rebuild differs from the original insertion
 * order and the comparison in the S1 harness fails for no real reason.
 *
 * **An omitted `w` or `h` means the minimum, not the stored size.**
 * `grid.save()` compresses its output through `Utils.removeInternalForSave`,
 * which drops `w` when it equals `1` *or* `minW`, and `h` likewise — the value
 * is re-created from the bounds on read, so gridstack has no reason to spend
 * bytes on it. Resolving it the same way is therefore the only reading that
 * round-trips.
 *
 * Falling back to the stored tile instead — which is what this did until
 * 2026-08-31 — is always wrong for a size, because `tileById` is written on
 * add, rebuild and settings changes and never on a resize: the record is the
 * pre-resize one by definition. It was harmless only while `w === 1` was the
 * sole way to trigger the omission and, in a grid whose tiles could reach 1×1,
 * it was not even harmless then. With doc 06 §5 rule 14's bounds in place a
 * tile dragged exactly to its minimum hits it every time, so a clock resized
 * to 2×1 would have gone on being stored at whatever it was before.
 *
 * `x` and `y` keep the stored fallback: `removeInternalForSave` only drops
 * `null`/`undefined`, and `0` is neither, so they are always present in
 * practice and the fallback is defensive rather than load-bearing.
 */
export function serialise(nodes: GridStackWidget[], tiles: Map<string, TpTile>): TpLayout {
	const grid: TpTile[] = [];

	for (const node of nodes) {
		const id = node.id;
		if (typeof id !== 'string') continue;
		const tile = tiles.get(id);
		if (!tile) continue;

		const min = getManifest(tile.widgetId)?.sizes.min;

		grid.push({
			...tile,
			x: node.x ?? tile.x,
			y: node.y ?? tile.y,
			w: node.w ?? min?.w ?? 1,
			h: node.h ?? min?.h ?? 1
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
