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

/**
 * Track metadata only — audio bytes live in `trackBlobs` or stay on disk (doc
 * 05 §4).
 *
 * The fields after `addedAt` arrived in Week 7a-1 and are not indexed, so they
 * needed no `version()` bump — and a row written before them (spike S2 wrote a
 * few on production) simply lacks them, which a rescan reads as "changed".
 */
export interface TpTrack {
	/**
	 * SHA-256 prefix of `fsa|<relPath>` or `blob|<relPath>|<size>|<mtime>`,
	 * NFC-normalised (doc 05 §4). The folder path alone, so a tag edit — which
	 * changes the size — keeps a track's id and its place in every playlist.
	 */
	id: string;
	source: 'fsa' | 'blob';
	/** fsa: the path under musicRoot; blob: the picked file's relative path or name. */
	relPath?: string;
	title: string;
	/** `''` when the file does not say — never a word in any language. */
	artist: string;
	/** `''` when the file does not say. */
	album: string;
	durationMs?: number;
	trackNo?: number;
	year?: number;
	/** Covers are deduped into trackBlobs as `cover:<hash>`, on both paths. */
	coverId?: string;
	addedAt: number;
	/** Bytes and last-modified time at the last scan — what a rescan compares. */
	size?: number;
	mtime?: number;
	/** Gone from a folder the last scan read. Never deleted for it (doc 09 §2). */
	missing?: true;
	/** Set by the player when this browser could not play it (plan S12). */
	error?: 'unreadable' | 'unsupported';
}

export interface TpTrackBlob {
	/** The track id for imported audio (path B), or `cover:<hash>` for artwork
	 *  from either path. */
	id: string;
	blob: Blob;
}

/** Music's library folder, under the id `musicRoot` (doc 09 §2). */
export interface TpFsaRoot {
	id: string;
	handle: FileSystemDirectoryHandle;
}

/**
 * A video the reader opened through the picker, under `media:<key>` (Week 7b,
 * doc 09 §3): the newest five, so one can be opened again after a reload. The
 * handle is a way back to the file, not the file.
 */
export interface TpFsaRecent {
	id: string;
	handle: FileSystemFileHandle;
	name: string;
	size: number;
	openedAt: number;
}

/**
 * One table, two kinds of handle. A reader of it checks `handle.kind` before
 * trusting a row, since the id alone does not say which a row holds.
 */
export type TpFsaHandle = TpFsaRoot | TpFsaRecent;

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

/**
 * Where a player was, between visits (`db.version(2)`, 2026-09-29) — the
 * music queue and position, and later media's per-file resume points.
 *
 * Its own table rather than tile settings, which is where doc 09 first put it
 * (the owner's decision, Week 7 plan Q1): `tp.layout.v1` does not sync across
 * tabs, so a position written into it every ten seconds would overwrite
 * another tab's layout edits, churn the bug report's `layoutHash`, and vanish
 * with the tile. A row per key (`'music'`, `'music:queue'`, …) keeps the
 * frequent small write away from the rare large one.
 *
 * `state` is `unknown` on purpose: core imports no widget code (doc 03), so
 * each widget reads its own rows through a validator that fails closed, the
 * way it reads its settings. **Not in backups** (doc 05 §6) — it is where the
 * reader was, not something they made.
 */
export interface TpPlaybackRow {
	id: string;
	updatedAt: number;
	state: unknown;
}

export type TpDb = Dexie & {
	notes: EntityTable<TpNote, 'id'>;
	todos: EntityTable<TpTodo, 'id'>;
	todoLists: EntityTable<TpTodoList, 'id'>;
	events: EntityTable<TpEvent, 'id'>;
	playlists: EntityTable<TpPlaylist, 'id'>;
	tracks: EntityTable<TpTrack, 'id'>;
	trackBlobs: EntityTable<TpTrackBlob, 'id'>;
	// The insert type spelled out: Dexie's default is an `Omit` over the
	// union, which is not distributive, and would refuse to `put` a recent.
	fsaHandles: EntityTable<TpFsaHandle, 'id', TpFsaHandle>;
	savedPlaces: EntityTable<TpSavedPlace, 'id'>;
	focusSessions: EntityTable<TpFocusSession, 'id'>;
	apiCache: EntityTable<TpApiCacheRow, 'key'>;
	fxHistory: EntityTable<TpFxSnapshot, 'dateKey'>;
	playback: EntityTable<TpPlaybackRow, 'id'>;
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

	// Week 7 (doc 05 §3). Only the new table: Dexie carries every earlier
	// version's stores forward, and listing one here with `null` would delete it.
	// No upgrade function — nothing existing changes shape.
	db.version(2).stores({
		playback: 'id'
	});

	return db;
}

export const db = createDb();

/**
 * Writes a `playback` row from a page on its way out (`pagehide`), issued
 * **and committed** before the handler returns.
 *
 * Dexie commits a write only once its request has succeeded, and a page being
 * unloaded never sees that: the transaction is aborted with the document, and
 * the row is lost. Measured 2026-09-29 in journey-media — the put went out at
 * `pagehide`, and after the reload nothing had been kept. `commit()` asks
 * for the commit up front, so the browser finishes without the page.
 *
 * Only for that moment: it bypasses Dexie's middleware and checks nothing, and
 * a database the page never opened has nothing to keep. Silent on failure — a
 * lost write costs the place, nothing else.
 */
export function putPlaybackNow(row: TpPlaybackRow, target: TpDb = db): void {
	if (!target.isOpen()) return;
	try {
		const transaction = target.backendDB().transaction('playback', 'readwrite');
		transaction.objectStore('playback').put(row);
		// Missing before Safari 15, where the write is as safe as it was.
		if (typeof transaction.commit === 'function') transaction.commit();
	} catch {
		// As above.
	}
}

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
