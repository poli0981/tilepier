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
