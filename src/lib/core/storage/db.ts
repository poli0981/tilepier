import Dexie, { type EntityTable } from 'dexie';

/**
 * IndexedDB schema (doc 05 §3).
 *
 * Rules that outlive this file: **never edit a shipped `version(n)` block** —
 * append a new one with an `upgrade()` — and every migration gets a test
 * (CLAUDE.md rule 10, doc 19 §3.3).
 */

export interface TpNote {
	id: string;
	title: string;
	body: string;
	updatedAt: number;
	pinned?: boolean;
}

export interface TpTodo {
	id: string;
	listId: string;
	text: string;
	done: boolean;
	due?: string;
	updatedAt: number;
}

export interface TpTodoList {
	id: string;
	name: string;
	order: number;
}

export interface TpEvent {
	id: string;
	/** `2026-08-30` — solar date, the key the calendar grid looks up. */
	dateKey: string;
	title: string;
	note?: string;
	lunarPinned?: boolean;
}

export interface TpPlaylist {
	id: string;
	name: string;
	order: number;
	trackIds: string[];
}

/** Track metadata only — audio bytes live in `trackBlobs` or stay on disk (doc 05 §4). */
export interface TpTrack {
	/** hash(path|name+size) — stable across sessions. */
	id: string;
	source: 'fsa' | 'blob';
	/** fsa: path relative to musicRoot. */
	relPath?: string;
	title: string;
	artist: string;
	album: string;
	durationMs?: number;
	trackNo?: number;
	year?: number;
	/** Covers are deduped into trackBlobs as `cover:<hash>`. */
	coverId?: string;
	addedAt: number;
}

export interface TpTrackBlob {
	/** Equals the track id, or `cover:<hash>` for artwork. */
	id: string;
	blob: Blob;
}

export interface TpFsaHandle {
	/** `musicRoot` is the only entry in v1. */
	id: string;
	handle: FileSystemDirectoryHandle;
}

export interface TpSavedPlace {
	id: string;
	name: string;
	lat: number;
	lon: number;
}

export interface TpFocusSession {
	id: string;
	dateKey: string;
	focusMs: number;
}

export interface TpApiCacheRow {
	/** The shared cache key (doc 04 §5) — same string the Worker uses in KV. */
	key: string;
	cachedAt: number;
	payload: unknown;
}

export interface TpFxSnapshot {
	dateKey: string;
	rates: Record<string, number>;
}

export type TpDb = Dexie & {
	notes: EntityTable<TpNote, 'id'>;
	todos: EntityTable<TpTodo, 'id'>;
	todoLists: EntityTable<TpTodoList, 'id'>;
	events: EntityTable<TpEvent, 'id'>;
	playlists: EntityTable<TpPlaylist, 'id'>;
	tracks: EntityTable<TpTrack, 'id'>;
	trackBlobs: EntityTable<TpTrackBlob, 'id'>;
	fsaHandles: EntityTable<TpFsaHandle, 'id'>;
	savedPlaces: EntityTable<TpSavedPlace, 'id'>;
	focusSessions: EntityTable<TpFocusSession, 'id'>;
	apiCache: EntityTable<TpApiCacheRow, 'key'>;
	fxHistory: EntityTable<TpFxSnapshot, 'dateKey'>;
};

export function createDb(name = 'tilepier'): TpDb {
	const db = new Dexie(name) as TpDb;

	// doc 05 §3, verbatim. Only indexed fields are listed; the rest of each
	// record is stored but not queryable, which is what Dexie expects.
	db.version(1).stores({
		notes: 'id, updatedAt',
		todos: 'id, listId, done, updatedAt',
		todoLists: 'id, order',
		events: 'id, dateKey',
		playlists: 'id, order',
		tracks: 'id, addedAt, title, artist',
		trackBlobs: 'id',
		fsaHandles: 'id',
		savedPlaces: 'id, name',
		focusSessions: 'id, dateKey',
		apiCache: 'key, cachedAt',
		fxHistory: 'dateKey'
	});

	return db;
}

export const db = createDb();

/**
 * Startup prune (doc 05 §3): drop cache entries older than 7 days, then cap at
 * 500 rows. Cheap enough to run on every load, and it keeps a long-lived
 * profile from accumulating payloads for widgets the user removed months ago.
 *
 * `target` defaults to the singleton; it is a parameter so the behaviour can be
 * checked against a throwaway database rather than the user's own.
 *
 * **`fxHistory` is deliberately untouched here**, and that is a decision rather
 * than an oversight. This function's contract is “cache”: everything it drops is
 * derivable from a request that can be made again. The fx snapshots are not —
 * no keyless API sells VND history back to us, which is the whole reason doc 10
 * §3 has the client accumulating them — so dropping a row here would be
 * dropping data. Its own bound lives with the code that writes it, as
 * `MIRROR_MAX_DAYS` in `widgets/currency/service.ts`.
 */
export async function pruneApiCache(now = Date.now(), target: TpDb = db): Promise<number> {
	const WEEK = 7 * 24 * 60 * 60 * 1000;
	const MAX_ROWS = 500;

	const expired = await target.apiCache
		.where('cachedAt')
		.below(now - WEEK)
		.primaryKeys();
	if (expired.length) await target.apiCache.bulkDelete(expired);

	const total = await target.apiCache.count();
	if (total > MAX_ROWS) {
		const oldest = await target.apiCache
			.orderBy('cachedAt')
			.limit(total - MAX_ROWS)
			.primaryKeys();
		await target.apiCache.bulkDelete(oldest);
		return expired.length + oldest.length;
	}

	return expired.length;
}
