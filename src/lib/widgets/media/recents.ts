import { db, type TpDb, type TpFsaHandle, type TpFsaRecent } from '$lib/core/storage/db';
import { POS_PREFIX, POSTER_PREFIX, readPoster } from './resume';
import { lruVictims, readResume, shouldResume } from './service';
import type { TpMediaFile } from './store.svelte';

/**
 * The videos a reader opened through the picker, kept so one opens again after
 * a reload without the picker (doc 09 §3; the owner's decision, 2026-09-29:
 * automatic, at most five, each with a way to forget it).
 *
 * - Rows `media:<key>` in `fsaHandles`, beside music's `musicRoot`, which
 *   nothing here touches: every query is by the `media:` prefix, and every
 *   row is checked to hold a file (`handle.kind`).
 * - File System Access handles only. A file from the `<input>` (Brave,
 *   Firefox) comes with none, and is found again by picking it.
 * - A handle is a way back to the file, not the file. The browser asks again
 *   before it reads, and a file moved or deleted says so.
 *
 * **Forgetting a video** takes its recent, its place and its still in one
 * transaction across both tables: nothing of it is left to find.
 */

const RECENT_PREFIX = 'media:';
/** The newest five, by when each was last opened. */
export const RECENTS_KEEP = 5;

function isRecent(row: TpFsaHandle): row is TpFsaRecent {
	return row.id.startsWith(RECENT_PREFIX) && row.handle.kind === 'file' && 'openedAt' in row;
}

/** Keeps a video the reader opened through the picker, the newest five. */
export async function rememberRecent(
	key: string,
	file: { name: string; size: number; handle: FileSystemFileHandle },
	now: number = Date.now(),
	target: TpDb = db
): Promise<void> {
	try {
		await target.transaction('rw', target.fsaHandles, async () => {
			await target.fsaHandles.put({
				id: RECENT_PREFIX + key,
				handle: file.handle,
				name: file.name,
				size: file.size,
				openedAt: now
			});
			const rows = (await target.fsaHandles.where('id').startsWith(RECENT_PREFIX).toArray())
				.filter(isRecent)
				.map((row) => ({ id: row.id, updatedAt: row.openedAt }));
			const victims = lruVictims(rows, RECENTS_KEEP);
			if (victims.length > 0) await target.fsaHandles.bulkDelete(victims);
		});
	} catch {
		// A recent is a courtesy to the next visit, not something to fail over.
	}
}

/** One video on the shelf: where it was left, its still, and a way back. */
export interface TpShelfRow {
	key: string;
	name: string;
	size: number;
	positionMs: number;
	durationMs: number;
	/** Its handle, when it was opened through the picker. */
	handle: FileSystemFileHandle | null;
	poster: Blob | null;
}

export interface TpShelf {
	/** The newest place worth coming back to. */
	last: TpShelfRow | null;
	/** The videos opened through the picker, newest first. */
	recents: TpShelfRow[];
}

/**
 * What a page with no video open offers — the tile after a reload, and the
 * detail. **Throws** when the tables cannot be read, so the tile can say so
 * rather than claim there is nothing.
 */
export async function readShelf(target: TpDb = db): Promise<TpShelf> {
	const [handles, places, stills] = await target.transaction(
		'r',
		[target.fsaHandles, target.playback],
		() =>
			Promise.all([
				target.fsaHandles.where('id').startsWith(RECENT_PREFIX).toArray(),
				target.playback.where('id').startsWith(POS_PREFIX).toArray(),
				target.playback.where('id').startsWith(POSTER_PREFIX).toArray()
			])
	);
	const recents = new Map(
		handles.filter(isRecent).map((row) => [row.id.slice(RECENT_PREFIX.length), row])
	);
	const posters = new Map(
		stills.map((row) => [row.id.slice(POSTER_PREFIX.length), readPoster(row.state)])
	);
	const place = new Map(
		places.map((row) => [row.id.slice(POS_PREFIX.length), { row, at: readResume(row.state) }])
	);

	let last: TpShelfRow | null = null;
	for (const [key, { at }] of [...place].sort((a, b) => b[1].row.updatedAt - a[1].row.updatedAt)) {
		if (at === null || !shouldResume(at.positionMs, at.durationMs)) continue;
		last = {
			key,
			...at,
			handle: recents.get(key)?.handle ?? null,
			poster: posters.get(key) ?? null
		};
		break;
	}

	const shelf = [...recents]
		.sort((a, b) => b[1].openedAt - a[1].openedAt)
		.map(([key, recent]): TpShelfRow => {
			const at = place.get(key)?.at ?? null;
			return {
				key,
				name: recent.name,
				size: recent.size,
				positionMs: at?.positionMs ?? 0,
				durationMs: at?.durationMs ?? 0,
				handle: recent.handle,
				poster: posters.get(key) ?? null
			};
		});
	return { last, recents: shelf };
}

export type TpReopened =
	{ kind: 'opened'; file: TpMediaFile } | { kind: 'denied' } | { kind: 'missing' };

/**
 * Opens a video from its handle, **from a click**: the permission is asked for
 * before anything else is awaited, while the click still counts as the
 * reader's gesture.
 */
export async function reopen(handle: FileSystemFileHandle): Promise<TpReopened> {
	if (typeof handle.requestPermission === 'function') {
		try {
			if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') {
				return { kind: 'denied' };
			}
		} catch {
			return { kind: 'denied' };
		}
	}
	try {
		const file = await handle.getFile();
		return { kind: 'opened', file: { name: file.name, size: file.size, file, handle } };
	} catch (error) {
		const name = (error as { name?: unknown }).name;
		return name === 'NotAllowedError' || name === 'SecurityError'
			? { kind: 'denied' }
			: { kind: 'missing' };
	}
}

/** Forgets one video: its recent, its place and its still, together. */
export async function forgetVideo(key: string, target: TpDb = db): Promise<void> {
	await target.transaction('rw', [target.fsaHandles, target.playback], async () => {
		await target.fsaHandles.delete(RECENT_PREFIX + key);
		await target.playback.bulkDelete([POS_PREFIX + key, POSTER_PREFIX + key]);
	});
}

/** Forgets every video. The volume stays: it is the reader's, not a video's. */
export async function forgetAllVideos(target: TpDb = db): Promise<void> {
	await target.transaction('rw', [target.fsaHandles, target.playback], async () => {
		await target.fsaHandles.where('id').startsWith(RECENT_PREFIX).delete();
		await target.playback.where('id').startsWith(POS_PREFIX).delete();
		await target.playback.where('id').startsWith(POSTER_PREFIX).delete();
	});
}
