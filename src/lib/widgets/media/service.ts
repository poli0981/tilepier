/**
 * The media widget's pure parts (doc 09 §3). No runes and no DOM, so they test
 * in the node project.
 */

/** The speeds the player offers (doc 09 §3: 0.5–2×). A new file starts at 1×. */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** How far the OS's skip keys move, in seconds, when they do not say. */
export const SKIP_SECONDS = 10;

/**
 * What a media element's error code means to the reader (doc 17 §4a):
 * - 4, source not supported: a format this browser does not play. Junk named
 *   `.mp4`, HEVC in most headless Chromium, MPEG-2 in MKV (doc 22 §S8).
 * - 2 (network) and 3 (decode): for a local file, one that changed or moved
 *   under the reader — worth one fresh read before saying so.
 * - 1, aborted: a newer source took over. Nothing to say.
 */
export function troubleOf(code: number | undefined): 'unsupported' | 'retry' | null {
	if (code === 4) return 'unsupported';
	if (code === 2 || code === 3) return 'retry';
	return null;
}

/* ───────────────────────────────── resume (db `playback`, Week 7b) */

/** A video resumes only past this much of it… */
const RESUME_AFTER_MS = 5_000;
/** …and not within this much of its end (doc 09 §3). */
const RESUME_BEFORE_END_MS = 5_000;
/** How many videos keep a place: the least recently watched go (doc 09 §3). */
export const RESUME_KEEP = 20;
/** How often a playing position is written, at most, as music does. */
export const SAVE_EVERY_MS = 10_000;

/** Where a video was left — keyed by its name and size, never its content. */
export interface TpResume {
	name: string;
	size: number;
	positionMs: number;
	durationMs: number;
}

/** A video's volume and mute are the reader's, not the file's: one row. */
export interface TpMediaPrefs {
	volume: number;
	muted: boolean;
}

/** Whether `positionMs` is worth coming back to (doc 09 §3). */
export function shouldResume(positionMs: number, durationMs: number): boolean {
	if (!Number.isFinite(positionMs) || positionMs <= RESUME_AFTER_MS) return false;
	return !(durationMs > 0 && durationMs - positionMs <= RESUME_BEFORE_END_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function finite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A saved place as this build will trust it, or `null` — fail closed (doc 05 §5). */
export function readResume(state: unknown): TpResume | null {
	if (!isRecord(state)) return null;
	const { name, size, positionMs, durationMs } = state;
	if (typeof name !== 'string' || !finite(size) || !finite(positionMs) || !finite(durationMs)) {
		return null;
	}
	return { name, size, positionMs, durationMs };
}

export function readPrefs(state: unknown): TpMediaPrefs | null {
	if (!isRecord(state)) return null;
	const { volume, muted } = state;
	if (!finite(volume) || volume > 1 || typeof muted !== 'boolean') return null;
	return { volume, muted };
}

/** The ids past the newest `keep`, oldest last touched first — what the LRU drops. */
export function lruVictims(
	rows: readonly { id: string; updatedAt: number }[],
	keep: number
): string[] {
	return [...rows]
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(keep)
		.map((row) => row.id);
}
