import { isLayout, LAYOUT_VERSION, type TpLayout, type TpTile } from '$lib/core/grid/layout';
import { newInstanceId } from '$lib/core/ids';
import { logEntry } from '$lib/core/log-buffer';
import { getManifest } from '$lib/core/registry';
import {
	createDebouncedWriter,
	readVersioned,
	writeVersioned,
	type TpDebouncedWriter,
	type TpVersionedSpec
} from '$lib/core/storage/local';
import { LOCAL_KEYS } from '$lib/shared-constants';
import { isWidgetId, type TpWidgetId } from '$lib/core/types';

/**
 * The deck — `tp.layout.v1` (doc 05 §2) and everything that reads or writes it.
 *
 * `TpGrid` stays a dumb imperative shell: it emits `onLayoutChange` on every
 * gridstack `change` and knows nothing about storage. The debounce lives here,
 * so a future import path (doc 05 §6) writes through the same one rather than
 * inventing a second.
 */

/** doc 04 §6. */
export const LAYOUT_DEBOUNCE_MS = 500;

/**
 * doc 13 §9's first-run deck, filtered through the registry so it only ever
 * contains widgets this build actually has. That makes it clock alone in
 * Week 1 and the full five by Week 3, with no separate list to remember.
 */
const SEED: readonly { widgetId: TpWidgetId; x: number; y: number; w: number; h: number }[] = [
	{ widgetId: 'clock', x: 0, y: 0, w: 3, h: 2 },
	{ widgetId: 'weather', x: 3, y: 0, w: 3, h: 2 },
	{ widgetId: 'calendar', x: 6, y: 0, w: 3, h: 3 },
	{ widgetId: 'notes', x: 0, y: 2, w: 3, h: 3 },
	{ widgetId: 'quote', x: 3, y: 2, w: 4, h: 2 }
];

export function seedDeck(): TpTile[] {
	return SEED.filter((entry) => getManifest(entry.widgetId) !== undefined).map((entry) => ({
		instanceId: newInstanceId(),
		widgetId: entry.widgetId,
		x: entry.x,
		y: entry.y,
		w: entry.w,
		h: entry.h,
		settings: {}
	}));
}

const LAYOUT_SPEC: TpVersionedSpec<TpLayout> = {
	key: LOCAL_KEYS.layout,
	version: LAYOUT_VERSION,
	// Nothing has shipped at v1 yet. Appending here is how v2 lands; never edit
	// a step that has shipped (doc 05 §5).
	migrations: [],
	validate: isLayout,
	fallback: () => ({ schemaVersion: 1, grid: seedDeck() })
};

class DeckStore {
	#tiles = $state<TpTile[]>([]);
	#loaded = $state(false);
	#writer: TpDebouncedWriter<TpLayout> | null = null;

	get tiles(): readonly TpTile[] {
		return this.#tiles;
	}

	/** False until storage has been read, so the grid does not mount an empty
	 *  deck and then rebuild — doc 03 §Rendering: the server emits an empty deck
	 *  area and there is nothing to flash. */
	get loaded(): boolean {
		return this.#loaded;
	}

	get widgetIds(): readonly string[] {
		return this.#tiles.map((tile) => tile.widgetId);
	}

	hydrate(): void {
		if (this.#loaded) return;

		const { value } = readVersioned(LAYOUT_SPEC);

		// doc 05 §5: a layout may name a widget a later release removed, or one
		// this build has not gained yet. Drop the tile, warn once, and rewrite —
		// without the rewrite the same warning returns on every single load.
		const kept: TpTile[] = [];
		let dropped = 0;
		for (const tile of value.grid) {
			if (isWidgetId(tile.widgetId) && getManifest(tile.widgetId) !== undefined) {
				kept.push(tile);
				continue;
			}
			dropped += 1;
			logEntry('warn', `dropped tile for unknown widget "${tile.widgetId}"`, { src: 'layout' });
		}

		this.#tiles = kept;
		this.#loaded = true;
		this.#writer = createDebouncedWriter(LAYOUT_SPEC, LAYOUT_DEBOUNCE_MS);

		if (dropped > 0) writeVersioned(LAYOUT_SPEC, this.#snapshot());
	}

	/** Bound to `TpGrid`'s `onLayoutChange`. Debounced, and flushed on hide. */
	applyLayout(layout: TpLayout): void {
		this.#tiles = layout.grid;
		this.#writer?.schedule(layout);
	}

	/**
	 * Returns the tile so the caller can hand it to `grid.addWidget` — the grid
	 * owns the DOM, this owns the data, and doc 06 §5 rule 9 says the prop will
	 * not carry it across.
	 *
	 * Null when the widget is unknown, or single-instance and already on deck
	 * (doc 06 §4).
	 */
	add(widgetId: TpWidgetId): TpTile | null {
		const manifest = getManifest(widgetId);
		if (manifest === undefined) return null;
		if (!manifest.multiInstance && this.#tiles.some((tile) => tile.widgetId === widgetId)) {
			return null;
		}

		// Below everything currently placed; gridstack compacts from there.
		const nextRow = this.#tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
		const tile: TpTile = {
			instanceId: newInstanceId(),
			widgetId,
			x: 0,
			y: nextRow,
			w: manifest.sizes.default.w,
			h: manifest.sizes.default.h,
			settings: {}
		};

		this.#tiles = [...this.#tiles, tile];
		this.#write();
		return tile;
	}

	remove(instanceId: string): void {
		this.#tiles = this.#tiles.filter((tile) => tile.instanceId !== instanceId);
		this.#write();
	}

	/** doc 06 §2: `onUpdateSettings(partial)` persists into the tile's settings. */
	updateSettings(instanceId: string, partial: Record<string, unknown>): void {
		this.#tiles = this.#tiles.map((tile) =>
			tile.instanceId === instanceId
				? { ...tile, settings: { ...tile.settings, ...partial } }
				: tile
		);
		this.#write();
	}

	/** Settings → Deck → "reset layout" (doc 13 §10). Immediate, not debounced:
	 *  the user asked for it and expects it to have happened. */
	reset(): void {
		this.#tiles = seedDeck();
		this.#writer?.flush();
		writeVersioned(LAYOUT_SPEC, this.#snapshot());
	}

	dispose(): void {
		this.#writer?.dispose();
		this.#writer = null;
		this.#loaded = false;
		this.#tiles = [];
	}

	#snapshot(): TpLayout {
		return { schemaVersion: 1, grid: this.#tiles };
	}

	#write(): void {
		this.#writer?.schedule(this.#snapshot());
	}
}

export const deck = new DeckStore();
