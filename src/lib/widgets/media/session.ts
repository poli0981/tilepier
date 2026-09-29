import {
	clearSession,
	pageSession,
	writeSessionHandlers,
	writeSessionMetadata,
	writeSessionPosition,
	writeSessionState,
	type TpMediaSession
} from '$lib/core/media-session';
import { claimPlayback, playbackOwner, releasePlayback } from '$lib/core/playback';
import { SKIP_SECONDS } from './service';

/**
 * The video's hold on the page's one sound and one Media Session (Week 7 plan
 * S4), the way music holds them, without importing music (CLAUDE.md rule 12).
 *
 * - **`claim`** when the video starts playing: the music player, if it was
 *   playing, is told to pause, and the session becomes this video's.
 * - **The session** carries the file's name, and answers play, pause, skip
 *   back and forward ten seconds, and seek. Previous and next stay unset: there
 *   is no queue, and on iOS the skip buttons are what a video wants.
 * - **Only while holding the claim**, so the music player's session is never
 *   written over; **`leave`** clears it and lets go.
 */
export interface TpVideoSession {
	claim(): void;
	/** Playing or paused, and where — after `playing` and `pause`. */
	state(playing: boolean): void;
	/** Where, at what speed — after a seek, a rate change or the metadata. */
	position(): void;
	leave(): void;
}

export function videoSession(
	video: HTMLVideoElement,
	title: string,
	session: () => TpMediaSession | null = pageSession
): TpVideoSession {
	const mine = (): TpMediaSession | null => (playbackOwner() === 'media' ? session() : null);

	const seekBy = (seconds: number): void => {
		const end = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
		video.currentTime = Math.min(end, Math.max(0, video.currentTime + seconds));
	};

	const position = (): void => {
		const current = mine();
		if (current === null) return;
		writeSessionPosition(
			current,
			video.duration * 1000,
			video.currentTime * 1000,
			video.playbackRate
		);
	};

	return {
		claim() {
			claimPlayback('media', () => video.pause());
			const current = mine();
			if (current === null) return;
			writeSessionHandlers(current, {
				play: () => void video.play().catch(() => undefined),
				pause: () => video.pause(),
				seekbackward: (details) => seekBy(-(details.seekOffset ?? SKIP_SECONDS)),
				seekforward: (details) => seekBy(details.seekOffset ?? SKIP_SECONDS),
				seekto: (details) => {
					if (details.seekTime !== undefined) video.currentTime = details.seekTime;
				}
			});
			writeSessionMetadata(current, { title, artist: '', album: '' });
		},
		state(playing) {
			const current = mine();
			if (current === null) return;
			writeSessionState(current, playing ? 'playing' : 'paused');
			position();
		},
		position,
		leave() {
			const current = mine();
			if (current !== null) clearSession(current);
			releasePlayback('media');
		}
	};
}
