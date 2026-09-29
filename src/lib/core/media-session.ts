/**
 * The page's one Media Session (doc 09 §2–§3), written through guards.
 *
 * `navigator.mediaSession` is what the OS's media keys, the lock screen and
 * the browser's media hub speak to. A page has one, and `core/playback`
 * decides whose it is: the player holding the claim writes here, and a player
 * that yields leaves it for the claimant to overwrite.
 *
 * **Every write is guarded**, because all of the API is optional and parts of
 * it throw on what a player produces in ordinary use:
 * - `setActionHandler` throws a `TypeError` for an action the browser does
 *   not know (older Safari and `seekto`, for one);
 * - `setPositionState` throws for a `NaN` duration — what an element reports
 *   before its metadata — and for a position past the end;
 * - `MediaMetadata` throws for an artwork URL it cannot parse.
 * A failed write costs the lock screen a detail, never the player.
 *
 * **An action a player does not name is set to `null`**, not left alone: the
 * previous owner's handler would otherwise keep answering. iOS also shows
 * skip-ten-seconds buttons *instead of* previous and next while a
 * `seekbackward` or `seekforward` handler exists, so a player that wants the
 * track buttons leaves those two out.
 */

const ACTIONS = [
	'play',
	'pause',
	'stop',
	'previoustrack',
	'nexttrack',
	'seekbackward',
	'seekforward',
	'seekto'
] as const satisfies readonly MediaSessionAction[];

type TpSessionHandlers = Partial<
	Record<(typeof ACTIONS)[number], (details: MediaSessionActionDetails) => void>
>;

interface TpSessionMetadata {
	title: string;
	artist: string;
	album: string;
	/** An object URL for the cover, with its type. */
	artwork?: { src: string; type: string } | undefined;
}

/** The part of `MediaSession` written here — the seam a test fills. */
export interface TpMediaSession {
	metadata: MediaMetadata | null;
	playbackState: MediaSessionPlaybackState;
	setActionHandler: MediaSession['setActionHandler'];
	/** Missing in browsers that predate it (Chrome 81, Safari 15). */
	setPositionState?: MediaSession['setPositionState'];
}

/** This page's session, or `null` in a browser without the API. */
export function pageSession(): TpMediaSession | null {
	if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
	return navigator.mediaSession;
}

/** Sets every action this module knows: to its handler, or to `null`. */
export function writeSessionHandlers(session: TpMediaSession, handlers: TpSessionHandlers): void {
	for (const action of ACTIONS) {
		try {
			session.setActionHandler(action, handlers[action] ?? null);
		} catch {
			// An action this browser does not know. The others still go in.
		}
	}
}

export function writeSessionMetadata(session: TpMediaSession, metadata: TpSessionMetadata): void {
	if (typeof MediaMetadata !== 'function') return;
	const { title, artist, album, artwork } = metadata;
	try {
		session.metadata = new MediaMetadata({
			title,
			artist,
			album,
			artwork: artwork === undefined ? [] : [artwork]
		});
	} catch {
		// An artwork URL it would not parse. The lock screen keeps what it had.
	}
}

export function writeSessionState(session: TpMediaSession, state: MediaSessionPlaybackState): void {
	session.playbackState = state;
}

/**
 * Where playback is, for the lock screen's scrubber. An unknown length —
 * before the metadata, or a stream — clears the position instead of throwing;
 * a position past the end is held at the end.
 *
 * `rate` is the speed it plays at: the OS moves the scrubber on by itself
 * between writes, so a video at 1.5× written as 1 would fall behind every
 * second (Week 7b). One it cannot use — zero, negative, not a number — is 1.
 */
export function writeSessionPosition(
	session: TpMediaSession,
	durationMs: number,
	positionMs: number,
	rate = 1
): void {
	if (session.setPositionState === undefined) return;
	try {
		if (!Number.isFinite(durationMs) || durationMs <= 0) {
			session.setPositionState();
			return;
		}
		const duration = durationMs / 1000;
		const at = Number.isFinite(positionMs) ? positionMs / 1000 : 0;
		session.setPositionState({
			duration,
			position: Math.min(duration, Math.max(0, at)),
			playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1
		});
	} catch {
		// Stricter about the same numbers than the spec: no scrubber, still sound.
	}
}

/** Nothing plays here any more: no words, no keys, no scrubber. */
export function clearSession(session: TpMediaSession): void {
	writeSessionHandlers(session, {});
	session.metadata = null;
	session.playbackState = 'none';
	writeSessionPosition(session, 0, 0);
}
