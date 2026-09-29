import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { claimPlayback, playbackOwner, resetPlayback } from '$lib/core/playback';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { media, type TpMediaFile } from './store.svelte';
import TpMediaPlayer from './TpMediaPlayer.svelte';
import clipUrl from './__fixtures__/clip.webm?url';
import junkUrl from './__fixtures__/not-video.mp4?url';
import soundUrl from './__fixtures__/sound-only.webm?url';

/**
 * The video player (doc 09 §3) against real files in the test browser, which
 * decodes VP9 and Opus (doc 22 §S8): it plays, it says what it cannot play, it
 * says when there is no picture, it takes the sound from the music player, and
 * it lets go of everything when it goes.
 */

async function fixture(url: string, name: string, type: string): Promise<TpMediaFile> {
	const bytes = await (await fetch(url)).arrayBuffer();
	const file = new File([bytes], name, { type });
	return { name, size: file.size, file };
}

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	media.reset();
	resetPlayback();
});

afterEach(() => {
	cleanup();
	media.reset();
	resetPlayback();
	settings.dispose();
	vi.restoreAllMocks();
});

function phase(container: HTMLElement): string | undefined {
	return container.querySelector<HTMLElement>('[data-testid="media-player"]')?.dataset['phase'];
}

describe('TpMediaPlayer', () => {
	it('plays the file it is given, and tells the tile how far it is', async () => {
		const file = await fixture(clipUrl, 'Phim thử.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });

		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'));
		const toggle = screen.getByTestId('media-toggle');
		if (toggle.element().getAttribute('aria-label') === m['widget.media.play']()) {
			await toggle.click();
		}
		await expect.element(toggle).toHaveAttribute('aria-label', m['widget.media.pause']());
		await vi.waitFor(() => expect(media.playing).toBe(true));
		expect(media.durationMs).toBe(14_008);
		await vi.waitFor(() => expect(media.positionMs).toBeGreaterThan(0));
	});

	it('plays on a press of "Play" even while a start is still on its way', async () => {
		// Between play() and `playing` the element is no longer paused while the
		// button still says "Play". A press then must not pause it: the whole
		// suite, under load, once caught exactly that.
		const started = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
		const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'));
		vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
		const toggle = screen.getByTestId('media-toggle');
		await expect.element(toggle).toHaveAttribute('aria-label', m['widget.media.play']());

		await toggle.click();

		expect(pause).not.toHaveBeenCalled();
		expect(started).toHaveBeenCalledTimes(2);
	});

	it('says plainly when this browser cannot play the file — never a black box', async () => {
		const file = await fixture(junkUrl, 'không phải video.mp4', 'video/mp4');
		const screen = render(TpMediaPlayer, { file });

		await expect.element(screen.getByTestId('media-unsupported')).toBeVisible();
		await expect.element(screen.getByText(m['widget.media.unsupported_hint']())).toBeVisible();
		expect(screen.container.querySelector('[data-testid="media-controls"]')).toBeNull();
		// A file it cannot play never took the sound from anything.
		expect(playbackOwner()).toBeNull();
	});

	it('plays sound with no picture, and says so', async () => {
		const file = await fixture(soundUrl, 'chỉ có tiếng.webm', 'audio/webm');
		const screen = render(TpMediaPlayer, { file });

		await expect.element(screen.getByTestId('media-audio-only')).toBeVisible();
		expect(phase(screen.container)).toBe('ready');
	});

	it('takes the sound from the music player when it plays, and gives it back when it goes', async () => {
		const musicYielded = vi.fn();
		claimPlayback('music', musicYielded);
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'));
		const toggle = screen.getByTestId('media-toggle');
		if (toggle.element().getAttribute('aria-label') === m['widget.media.play']()) {
			await toggle.click();
		}

		await vi.waitFor(() => expect(playbackOwner()).toBe('media'));
		expect(musicYielded).toHaveBeenCalledOnce();

		const video = screen.getByTestId('media-video').element() as HTMLVideoElement;
		cleanup();

		expect(playbackOwner()).toBeNull();
		expect(video.paused).toBe(true);
		expect(video.hasAttribute('src')).toBe(false);
		expect(media.playing).toBe(false);
	});

	it('pauses when the music player takes the sound back', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'));
		const toggle = screen.getByTestId('media-toggle');
		if (toggle.element().getAttribute('aria-label') === m['widget.media.play']()) {
			await toggle.click();
		}
		await vi.waitFor(() => expect(playbackOwner()).toBe('media'));

		claimPlayback('music', () => {});

		await expect.element(toggle).toHaveAttribute('aria-label', m['widget.media.play']());
		expect(media.playing).toBe(false);
	});
});
