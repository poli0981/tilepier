import { sha256Hex } from '$lib/core/hash';
import { db, putPlaybackNow, type TpDb } from '$lib/core/storage/db';
import {
	lruVictims,
	readPrefs,
	readResume,
	RESUME_KEEP,
	shouldResume,
	type TpMediaPrefs,
	type TpResume
} from './service';

/**
 * Where each video was left, and the reader's volume (doc 09 §3) — media's rows
 * in the `playback` table music shares (owner decision Q1):
 * - `media:pos:<key>`, a {@link TpResume} per video, the newest twenty kept;
 * - `media:prefs`, one {@link TpMediaPrefs}. Speed is not kept: every file
 *   starts at 1×.
 *
 * **A video's key is its name and size, hashed** — never its content. Reading
 * a film to hash it would take longer than opening it, and the same file picked
 * again, after a reload or through the other picker, has to find its place. Two
 * files with the same name and size share one, which is the price. Without
 * `crypto.subtle` (plain http) there is no key: the video plays from the start
 * and nothing is kept.
 *
 * **Nothing here touches a row outside `media:`** — music's rows share the
 * table — and every write fails soft: a full disk costs the place, nothing
 * else. A page on its way out writes with the `…Now` pair, which commit before
 * they return (`putPlaybackNow`). `target` is the test seam.
 */

const POS_PREFIX = 'media:pos:';
const PREFS_ID = 'media:prefs';

export async function resumeKey(name: string, size: number): Promise<string | null> {
	try {
		return await sha256Hex(`${name.normalize('NFC')}|${String(size)}`, 12);
	} catch {
		return null;
	}
}

/** Where the video under `key` was left, or `null` — a read that fails is `null`. */
export async function loadResume(key: string, target: TpDb = db): Promise<TpResume | null> {
	try {
		return readResume((await target.playback.get(POS_PREFIX + key))?.state);
	} catch {
		return null;
	}
}

/**
 * The newest place worth coming back to, for a page with no video open — the
 * tile after a reload. **Throws** when the table cannot be read, so the tile can
 * say so rather than claim there is nothing.
 */
export async function latestResume(target: TpDb = db): Promise<TpResume | null> {
	const rows = await target.playback.where('id').startsWith(POS_PREFIX).toArray();
	rows.sort((a, b) => b.updatedAt - a.updatedAt);
	for (const row of rows) {
		const resume = readResume(row.state);
		if (resume !== null && shouldResume(resume.positionMs, resume.durationMs)) return resume;
	}
	return null;
}

/**
 * Keeps where the video under `key` is, and drops the places past the newest
 * twenty — in one transaction, so no reader of the table sees twenty-one.
 */
export async function saveResume(
	key: string,
	resume: TpResume,
	now: number = Date.now(),
	target: TpDb = db
): Promise<void> {
	try {
		await target.transaction('rw', target.playback, async () => {
			await target.playback.put({ id: POS_PREFIX + key, updatedAt: now, state: resume });
			const rows = await target.playback.where('id').startsWith(POS_PREFIX).toArray();
			const victims = lruVictims(rows, RESUME_KEEP);
			if (victims.length > 0) await target.playback.bulkDelete(victims);
		});
	} catch {
		// A full disk costs the place, nothing else.
	}
}

/** `saveResume` from a closing page: committed before it returns. It trims
 *  nothing — the next ordinary save does. */
export function saveResumeNow(
	key: string,
	resume: TpResume,
	now: number = Date.now(),
	target: TpDb = db
): void {
	putPlaybackNow({ id: POS_PREFIX + key, updatedAt: now, state: resume }, target);
}

export async function loadPrefs(target: TpDb = db): Promise<TpMediaPrefs | null> {
	try {
		return readPrefs((await target.playback.get(PREFS_ID))?.state);
	} catch {
		return null;
	}
}

export async function savePrefs(
	prefs: TpMediaPrefs,
	now: number = Date.now(),
	target: TpDb = db
): Promise<void> {
	try {
		await target.playback.put({ id: PREFS_ID, updatedAt: now, state: prefs });
	} catch {
		// As above.
	}
}

export function savePrefsNow(
	prefs: TpMediaPrefs,
	now: number = Date.now(),
	target: TpDb = db
): void {
	putPlaybackNow({ id: PREFS_ID, updatedAt: now, state: prefs }, target);
}
