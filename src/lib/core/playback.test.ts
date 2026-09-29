import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimPlayback, playbackOwner, releasePlayback, resetPlayback } from './playback';

afterEach(() => {
	resetPlayback();
});

describe('claimPlayback (Week 7 plan S4)', () => {
	it('tells the other player to yield when one starts', () => {
		const musicYields = vi.fn();
		claimPlayback('music', musicYields);

		claimPlayback('media', vi.fn());

		expect(musicYields).toHaveBeenCalledTimes(1);
		expect(playbackOwner()).toBe('media');
	});

	it('does not make a player yield to itself', () => {
		const first = vi.fn();
		const second = vi.fn();
		claimPlayback('music', first);

		claimPlayback('music', second);

		expect(first).not.toHaveBeenCalled();
		// The newer callback is the one that counts from here on.
		claimPlayback('media', vi.fn());
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('is the new owner by the time the old one yields', () => {
		// A yield that pauses fires `pause`, and a pause handler that releases
		// must not release the claim the newcomer just made.
		claimPlayback('music', () => releasePlayback('music'));

		claimPlayback('media', vi.fn());

		expect(playbackOwner()).toBe('media');
	});
});

describe('releasePlayback', () => {
	it('lets go of its own claim and nobody else’s', () => {
		claimPlayback('media', vi.fn());

		releasePlayback('music');
		expect(playbackOwner()).toBe('media');

		releasePlayback('media');
		expect(playbackOwner()).toBeNull();
	});

	it('means a later claim has nobody to make yield', () => {
		const musicYields = vi.fn();
		claimPlayback('music', musicYields);
		releasePlayback('music');

		claimPlayback('media', vi.fn());

		expect(musicYields).not.toHaveBeenCalled();
	});
});
