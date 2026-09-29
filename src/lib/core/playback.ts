/**
 * One sound at a time (Week 7 plan S4).
 *
 * The music player and the media player are separate widgets that may not
 * import each other (CLAUDE.md rule 12), and the page has one
 * `navigator.mediaSession`: the OS's media keys and lock screen can speak for
 * one player, not two. So whoever starts playing *claims* playback here, and
 * whoever held it before is told to yield — to pause, and to take its hands off
 * the Media Session, which the claimant is about to fill with its own.
 *
 * A claim is not a lock. Nothing waits on it and nothing can refuse it: the
 * player the reader just pressed play on always wins, which is what "one sound
 * at a time" means to a person.
 */

export type TpPlaybackOwner = 'music' | 'media';

interface TpClaim {
	owner: TpPlaybackOwner;
	onYield: () => void;
}

let current: TpClaim | null = null;

/**
 * `owner` is about to make a sound. The previous owner, if it is a different
 * one, is told to yield first; a re-claim by the same owner only refreshes its
 * callback.
 */
export function claimPlayback(owner: TpPlaybackOwner, onYield: () => void): void {
	const previous = current;
	current = { owner, onYield };
	if (previous !== null && previous.owner !== owner) previous.onYield();
}

/** `owner` has gone quiet on its own — paused, stopped, or its tile removed. */
export function releasePlayback(owner: TpPlaybackOwner): void {
	if (current?.owner === owner) current = null;
}

export function playbackOwner(): TpPlaybackOwner | null {
	return current?.owner ?? null;
}

/** Test seam, in the shape `ui`, `online` and `toasts` use. */
export function resetPlayback(): void {
	current = null;
}
