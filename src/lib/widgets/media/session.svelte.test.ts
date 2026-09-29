import { afterEach, describe, expect, it } from 'vitest';
import { claimPlayback, playbackOwner, resetPlayback } from '$lib/core/playback';
import type { TpMediaSession } from '$lib/core/media-session';
import { videoSession } from './session';

/**
 * The video's hold on the sound and the Media Session (Week 7 plan S4),
 * against a stand-in element and session: what the OS's keys do, where the
 * lock screen's scrubber stands and at what speed, and that it writes nothing
 * while the music player holds the sound.
 */

class FakeVideo {
	currentTime = 30;
	duration = 120;
	playbackRate = 1;
	paused = true;
	async play(): Promise<void> {
		this.paused = false;
	}
	pause(): void {
		this.paused = true;
	}
}

class FakeSession implements TpMediaSession {
	metadata: MediaMetadata | null = null;
	playbackState: MediaSessionPlaybackState = 'none';
	handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
	positions: (MediaPositionState | undefined)[] = [];
	setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
		this.handlers.set(action, handler);
	}
	setPositionState(state?: MediaPositionState): void {
		this.positions.push(state);
	}
	press(action: MediaSessionAction, details: Partial<MediaSessionActionDetails> = {}): void {
		const handler = this.handlers.get(action);
		if (typeof handler !== 'function') throw new Error(`no handler for ${action}`);
		handler({ action, ...details });
	}
}

function setup() {
	const video = new FakeVideo();
	const session = new FakeSession();
	const hold = videoSession(video as unknown as HTMLVideoElement, 'Phim thử.webm', () => session);
	return { video, session, hold };
}

afterEach(() => {
	resetPlayback();
});

describe('videoSession', () => {
	it('shows the video’s still on the lock screen when it has one', () => {
		const video = new FakeVideo();
		const session = new FakeSession();
		const hold = videoSession(
			video as unknown as HTMLVideoElement,
			'Phim thử.webm',
			() => session,
			() => 'blob:still'
		);

		hold.claim();

		expect(session.metadata?.artwork[0]?.src).toContain('blob:still');
	});

	it('takes the sound, names the file, and answers play, pause, skip and seek', async () => {
		const { video, session, hold } = setup();

		hold.claim();

		expect(playbackOwner()).toBe('media');
		expect(session.metadata?.title).toBe('Phim thử.webm');
		// No queue: previous and next stay unset, and iOS shows the skips.
		expect(session.handlers.get('previoustrack')).toBeNull();
		expect(session.handlers.get('nexttrack')).toBeNull();

		session.press('play');
		await Promise.resolve();
		expect(video.paused).toBe(false);
		session.press('pause');
		expect(video.paused).toBe(true);

		session.press('seekforward');
		expect(video.currentTime).toBe(40);
		session.press('seekbackward', { seekOffset: 100 });
		expect(video.currentTime).toBe(0);
		session.press('seekforward', { seekOffset: 500 });
		expect(video.currentTime).toBe(120);
		session.press('seekto', { seekTime: 61 });
		expect(video.currentTime).toBe(61);
	});

	it('writes the state and the scrubber at the speed that plays', () => {
		const { video, session, hold } = setup();
		hold.claim();
		video.playbackRate = 1.5;

		hold.state(true);

		expect(session.playbackState).toBe('playing');
		expect(session.positions.at(-1)).toEqual({ duration: 120, position: 30, playbackRate: 1.5 });
	});

	it('writes nothing while the music player holds the sound, and lets go when it leaves', () => {
		const { session, hold } = setup();
		hold.claim();
		claimPlayback('music', () => {});

		hold.state(false);
		hold.position();
		expect(session.playbackState).toBe('none');
		expect(session.positions).toEqual([]);

		claimPlayback('media', () => {});
		hold.leave();
		expect(playbackOwner()).toBeNull();
		expect(session.metadata).toBeNull();
	});

	it('pauses the video when the music player takes the sound', () => {
		const { video, hold } = setup();
		video.paused = false;
		hold.claim();

		claimPlayback('music', () => {});

		expect(video.paused).toBe(true);
	});
});
