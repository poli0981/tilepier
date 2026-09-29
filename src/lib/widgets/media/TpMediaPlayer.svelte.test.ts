import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-svelte';
import { claimPlayback, playbackOwner, resetPlayback } from '$lib/core/playback';
import { db } from '$lib/core/storage/db';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { POSTER_MAX_BYTES } from './poster';
import { loadPoster, loadPrefs, loadResume, resumeKey, saveResume } from './resume';
import { media, type TpMediaFile } from './store.svelte';
import TpMediaPlayer from './TpMediaPlayer.svelte';
import clipUrl from './__fixtures__/clip.webm?url';
import junkUrl from './__fixtures__/not-video.mp4?url';
import soundUrl from './__fixtures__/sound-only.webm?url';
import vttUrl from './__fixtures__/subs.vi.vtt?url';

/**
 * The video player (doc 09 §3) against real files in the test browser, which
 * decodes VP9 and Opus (doc 22 §S8): it plays, it says what it cannot play, it
 * says when there is no picture, it takes the sound from the music player, it
 * picks a video up where it was left, and it lets go of everything when it goes
 * — keeping its place first.
 */

/**
 * A real decoder and real IndexedDB in a browser the whole suite shares: on
 * CI's two cores a video's first frames, and a write under load, have come
 * later than the default second (#35, 2026-09-29). The waits on either get
 * five; nothing here is about how fast they come.
 */
const SLOW = { timeout: 5_000 };

async function fixture(url: string, name: string, type: string): Promise<TpMediaFile> {
	const bytes = await (await fetch(url)).arrayBuffer();
	const file = new File([bytes], name, { type });
	return { name, size: file.size, file };
}

/** Media's rows only: music's, in the same table, belong to other tests. */
async function forgetMedia(): Promise<void> {
	await db.playback.where('id').startsWith('media:').delete();
	await db.fsaHandles.where('id').startsWith('media:').delete();
}

/**
 * One video, started by a click, before any test: the page then has the
 * activation a reader's first press gives it, and every player after it starts
 * on its own — so no test depends on whether the browser allows sound before a
 * gesture. A start that never comes is reported with what the page looked
 * like. (Added for #35's CI, whose first test kept failing with the video
 * paused; the cause was the tests' own check-then-press, fixed in `playing`.)
 */
beforeAll(async () => {
	const video = document.createElement('video');
	const start = document.createElement('button');
	start.textContent = 'start';
	start.addEventListener('click', () => void video.play().catch(() => undefined));
	video.src = clipUrl;
	document.body.appendChild(video);
	document.body.appendChild(start);
	try {
		await page.elementLocator(start).click();
		await vi.waitFor(() => expect(video.currentTime).toBeGreaterThan(0), {
			timeout: 25_000,
			interval: 250
		});
	} catch {
		console.warn(
			`media warm-up: no start in 25 s — visibility ${document.visibilityState}, ` +
				`readyState ${String(video.readyState)}, paused ${String(video.paused)}, ` +
				`error ${String(video.error?.code ?? 'none')}`
		);
	} finally {
		video.pause();
		video.removeAttribute('src');
		video.load();
		video.remove();
		start.remove();
	}
}, 30_000);

beforeEach(async () => {
	settings.dispose();
	settings.hydrate();
	media.reset();
	resetPlayback();
	await forgetMedia();
});

afterEach(async () => {
	cleanup();
	media.reset();
	resetPlayback();
	settings.dispose();
	vi.restoreAllMocks();
	await forgetMedia();
});

function phase(container: HTMLElement): string | undefined {
	return container.querySelector<HTMLElement>('[data-testid="media-player"]')?.dataset['phase'];
}

/** Where the player last kept `file`, as the next page would read it. */
async function kept(file: TpMediaFile): Promise<number | undefined> {
	const key = await resumeKey(file.name, file.size);
	return key === null ? undefined : (await loadResume(key))?.positionMs;
}

/**
 * Waits until the player's video plays. It starts on its own; a press is only
 * for a start the browser refused, which the player says ("press play").
 *
 * **Not "if the button says Play, press it".** Between reading the label and
 * the press landing, playback can begin — and then the press pauses it, and
 * the video never plays. On CI that race failed a test three times, twice on
 * the file's first test and once on a later one (#35, #37; 2026-09-29).
 */
async function playing(screen: ReturnType<typeof render>): Promise<HTMLVideoElement> {
	await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
	const refused = () =>
		screen.container.textContent?.includes(m['widget.media.press_play']()) === true;
	await vi.waitFor(() => expect(media.playing || refused()).toBe(true), SLOW);
	if (!media.playing) await screen.getByTestId('media-toggle').click();
	await vi.waitFor(() => expect(media.playing).toBe(true), SLOW);
	return screen.getByTestId('media-video').element() as HTMLVideoElement;
}

describe('TpMediaPlayer', () => {
	it('plays the file it is given, and tells the tile how far it is', async () => {
		const file = await fixture(clipUrl, 'Phim thử.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });

		await playing(screen);

		await expect
			.element(screen.getByTestId('media-toggle'))
			.toHaveAttribute('aria-label', m['widget.media.pause']());
		expect(media.durationMs).toBe(14_008);
		await vi.waitFor(() => expect(media.positionMs).toBeGreaterThan(0), SLOW);
	});

	it('plays on a press of "Play" even while a start is still on its way', async () => {
		// Between play() and `playing` the element is no longer paused while the
		// button still says "Play". A press then must not pause it: the whole
		// suite, under load, once caught exactly that.
		const started = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
		const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause');
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockReturnValue(false);
		const toggle = screen.getByTestId('media-toggle');
		await expect.element(toggle, SLOW).toHaveAttribute('aria-label', m['widget.media.play']());

		await toggle.click();

		expect(pause).not.toHaveBeenCalled();
		expect(started).toHaveBeenCalledTimes(2);
	});

	it('says plainly when this browser cannot play the file — never a black box', async () => {
		const file = await fixture(junkUrl, 'không phải video.mp4', 'video/mp4');
		const screen = render(TpMediaPlayer, { file });

		await expect.element(screen.getByTestId('media-unsupported'), SLOW).toBeVisible();
		await expect
			.element(screen.getByText(m['widget.media.unsupported_hint']()), SLOW)
			.toBeVisible();
		expect(screen.container.querySelector('[data-testid="media-controls"]')).toBeNull();
		// A file it cannot play never took the sound from anything.
		expect(playbackOwner()).toBeNull();
	});

	it('plays sound with no picture, and says so', async () => {
		const file = await fixture(soundUrl, 'chỉ có tiếng.webm', 'audio/webm');
		const screen = render(TpMediaPlayer, { file });

		await expect.element(screen.getByTestId('media-audio-only'), SLOW).toBeVisible();
		expect(phase(screen.container)).toBe('ready');
	});

	it('takes the sound from the music player when it plays, and gives it back when it goes', async () => {
		const musicYielded = vi.fn();
		claimPlayback('music', musicYielded);
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await playing(screen);

		expect(playbackOwner()).toBe('media');
		expect(musicYielded).toHaveBeenCalledOnce();

		const video = screen.getByTestId('media-video').element() as HTMLVideoElement;
		cleanup();

		expect(playbackOwner()).toBeNull();
		expect(video.paused).toBe(true);
		expect(video.hasAttribute('src')).toBe(false);
		expect(media.playing).toBe(false);
	});

	it('takes focus when it loads, and answers the keys where the reader is', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		const video = screen.getByTestId('media-video').element() as HTMLVideoElement;
		expect(document.activeElement).toBe(video);
		const heard = vi.fn();
		document.addEventListener('keydown', heard);

		try {
			const before = video.currentTime;
			const seek = new KeyboardEvent('keydown', {
				key: 'ArrowRight',
				bubbles: true,
				cancelable: true
			});
			video.dispatchEvent(seek);
			expect(video.currentTime).toBeCloseTo(before + 5, 0);
			// Answered at the player: the detail does not scroll, and nothing
			// underneath hears it.
			expect(seek.defaultPrevented).toBe(true);
			expect(heard).not.toHaveBeenCalled();

			video.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
			await vi.waitFor(() => expect(video.muted).toBe(true), SLOW);

			// Escape is the detail's, and goes on up.
			video.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			expect(heard).toHaveBeenCalledOnce();
		} finally {
			document.removeEventListener('keydown', heard);
		}
	});

	it('offers picture-in-picture for a picture, and ends it when the player goes', async () => {
		const requested = vi
			.spyOn(HTMLVideoElement.prototype, 'requestPictureInPicture')
			.mockResolvedValue({} as PictureInPictureWindow);
		const exited = vi.spyOn(Document.prototype, 'exitPictureInPicture').mockResolvedValue();
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);

		await screen.getByTestId('media-pip').click();
		expect(requested).toHaveBeenCalledOnce();

		const video = screen.getByTestId('media-video').element();
		vi.spyOn(Document.prototype, 'pictureInPictureElement', 'get').mockReturnValue(video);
		cleanup();
		expect(exited).toHaveBeenCalledOnce();
	});

	it('offers no picture-in-picture for sound alone', async () => {
		const file = await fixture(soundUrl, 'sound.webm', 'audio/webm');
		const screen = render(TpMediaPlayer, { file });

		await expect.element(screen.getByTestId('media-audio-only'), SLOW).toBeVisible();
		expect(screen.container.querySelector('[data-testid="media-pip"]')).toBeNull();
	});

	it('goes full screen with the player, controls and all, from the button or F', async () => {
		const requested = vi.spyOn(Element.prototype, 'requestFullscreen').mockResolvedValue();
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		const box = screen.getByTestId('media-player').element();

		await screen.getByTestId('media-fullscreen').click();
		expect(requested).toHaveBeenCalledOnce();
		expect(requested.mock.contexts[0]).toBe(box);

		screen
			.getByTestId('media-video')
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
		expect(requested).toHaveBeenCalledTimes(2);
	});

	it('pauses when the music player takes the sound back', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await playing(screen);
		expect(playbackOwner()).toBe('media');
		const toggle = screen.getByTestId('media-toggle');

		claimPlayback('music', () => {});

		await expect.element(toggle, SLOW).toHaveAttribute('aria-label', m['widget.media.play']());
		expect(media.playing).toBe(false);
	});
	it('keeps its place when it goes mid-play, read before the element lets go of the file', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		const video = await playing(screen);
		video.currentTime = 8;
		// The seek is kept as well; playing on past it is what only the
		// teardown can keep.
		await vi.waitFor(() => expect(video.currentTime).toBeGreaterThan(8.6), SLOW);

		const at = video.currentTime * 1000;
		cleanup();

		await vi.waitFor(async () => expect(await kept(file)).toBeCloseTo(at, -2), SLOW);
	});

	it('keeps its place when the page closes, committed before the page can go', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		const video = await playing(screen);
		video.currentTime = 8;
		await vi.waitFor(() => expect(video.currentTime).toBeGreaterThan(8.3), SLOW);
		const commit = vi.spyOn(IDBTransaction.prototype, 'commit');

		window.dispatchEvent(new PageTransitionEvent('pagehide'));

		// Inside the handler: after it, a closing page runs nothing more.
		expect(commit).toHaveBeenCalled();
		commit.mockRestore();
		await vi.waitFor(async () => expect(await kept(file)).toBeGreaterThan(8_300), SLOW);
	});

	it('picks a video up where it was left, and starts over on request', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const key = await resumeKey(file.name, file.size);
		if (key === null) throw new Error('the test browser hashes');
		await saveResume(key, {
			name: file.name,
			size: file.size,
			positionMs: 9_000,
			durationMs: 14_008
		});
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		const video = screen.getByTestId('media-video').element() as HTMLVideoElement;

		expect(video.currentTime).toBeCloseTo(9, 1);
		await expect
			.element(screen.getByText(m['widget.media.resumed']({ position: '0:09' })), SLOW)
			.toBeVisible();

		await screen.getByTestId('media-start-over').click();

		expect(video.currentTime).toBeLessThan(1);
		expect(screen.container.querySelector('[data-testid="media-resumed"]')).toBeNull();
		await vi.waitFor(async () => expect(await kept(file)).toBeLessThan(1_000), SLOW);
	});

	it('puts a video watched to the end back to its start', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		const video = await playing(screen);
		video.currentTime = 13.4;
		await vi.waitFor(() => expect(video.ended).toBe(true), { timeout: 5_000 });

		await vi.waitFor(async () => expect(await kept(file)).toBe(0), SLOW);
	});

	it('keeps the reader’s volume from one video to the next, and not the speed', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const first = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(first.container)).toBe('ready'), SLOW);
		const video = first.getByTestId('media-video').element() as HTMLVideoElement;
		for (const key of ['ArrowDown', 'ArrowDown']) {
			video.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
		}
		await first.getByTestId('media-speed').selectOptions('1.5');
		await vi.waitFor(() => expect(video.playbackRate).toBe(1.5), SLOW);
		cleanup();
		await vi.waitFor(
			async () => expect(await loadPrefs()).toEqual({ volume: 0.8, muted: false }),
			SLOW
		);

		const next = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(next.container)).toBe('ready'), SLOW);
		const again = next.getByTestId('media-video').element() as HTMLVideoElement;

		expect(again.volume).toBeCloseTo(0.8, 5);
		expect(again.playbackRate).toBe(1);
	});
});

describe('subtitles', () => {
	const SRT = [
		'1',
		'00:00:00,500 --> 00:00:04,000',
		'{\\an8}<i>Xin chào</i> — phụ đề',
		'',
		'2',
		'00:00:04,500 --> 00:00:09,000',
		'Một & hai',
		''
	].join('\r\n');

	/** The File System Access picker, answering with `file`. */
	function offer(file: File): void {
		window.showOpenFilePicker = async () => [
			{ kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle
		];
	}

	afterEach(() => {
		Reflect.deleteProperty(window, 'showOpenFilePicker');
	});

	it('shows the subtitles the reader adds, and C hides and shows them', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		const video = screen.getByTestId('media-video').element() as HTMLVideoElement;
		offer(new File([SRT], 'clip.vi.srt'));

		await screen.getByTestId('media-captions').click();

		await vi.waitFor(() => expect(video.textTracks[0]?.cues?.length).toBe(2), SLOW);
		const track = video.querySelector('track');
		expect(track?.srclang).toBe('vi');
		expect(track?.label).toBe('clip.vi.srt');
		expect(video.textTracks[0]?.mode).toBe('showing');
		const first = video.textTracks[0]?.cues?.[0] as VTTCue;
		expect(first.startTime).toBe(0.5);
		expect(first.text).toBe('<i>Xin chào</i> — phụ đề');
		expect((video.textTracks[0]?.cues?.[1] as VTTCue).getCueAsHTML().textContent).toBe('Một & hai');
		await expect
			.element(screen.getByText(m['widget.media.subs_loaded']({ name: 'clip.vi.srt' })), SLOW)
			.toBeVisible();

		video.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));

		expect(video.textTracks[0]?.mode).toBe('hidden');
		await expect
			.element(screen.getByTestId('media-captions'), SLOW)
			.toHaveAttribute('aria-label', m['widget.media.subs_show']());
		await screen.getByTestId('media-captions').click();
		expect(video.textTracks[0]?.mode).toBe('showing');
	});

	it('says so when a file holds no subtitles, and adds no track', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		offer(new File(['không phải phụ đề'], 'ghi chú.srt'));

		await screen.getByTestId('media-captions').click();

		await expect
			.element(screen.getByText(m['widget.media.subs_unreadable']({ name: 'ghi chú.srt' })), SLOW)
			.toBeVisible();
		expect(screen.container.querySelector('track')).toBeNull();
	});

	it('lets go of the track and its URL when the player goes', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		const video = screen.getByTestId('media-video').element() as HTMLVideoElement;
		offer(new File([SRT], 'clip.vi.srt'));
		await screen.getByTestId('media-captions').click();
		await vi.waitFor(() => expect(video.querySelector('track')).not.toBeNull(), SLOW);
		const url = video.querySelector('track')?.src;

		cleanup();

		expect(video.querySelector('track')).toBeNull();
		expect(revoke).toHaveBeenCalledWith(url);
	});

	it('takes WebVTT as it is', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		const video = screen.getByTestId('media-video').element() as HTMLVideoElement;
		const vtt = await (await fetch(vttUrl)).text();
		offer(new File([vtt], 'subs.vi.vtt'));

		await screen.getByTestId('media-captions').click();

		await vi.waitFor(() => expect(video.textTracks[0]?.cues?.length).toBe(2), SLOW);
		expect((video.textTracks[0]?.cues?.[1] as VTTCue).text).toBe('<b>Đậm</b> và thường.');
	});

	it('says so when the browser finds no cue in a WebVTT file, and takes the track away', async () => {
		const file = await fixture(clipUrl, 'clip.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		await vi.waitFor(() => expect(phase(screen.container)).toBe('ready'), SLOW);
		// It says WEBVTT and has an arrow, so it goes to the browser, which
		// finds no timing it can read.
		offer(new File(['WEBVTT\n\nnot a time --> nor this\nchữ\n'], 'hỏng.vtt'));

		await screen.getByTestId('media-captions').click();

		await expect
			.element(screen.getByText(m['widget.media.subs_unreadable']({ name: 'hỏng.vtt' })), SLOW)
			.toBeVisible();
		expect(screen.container.querySelector('track')).toBeNull();
		await expect
			.element(screen.getByTestId('media-captions'), SLOW)
			.toHaveAttribute('aria-label', m['widget.media.subs_add']());
	});

	it('offers none for sound alone', async () => {
		const file = await fixture(soundUrl, 'sound.webm', 'audio/webm');
		const screen = render(TpMediaPlayer, { file });

		await expect.element(screen.getByTestId('media-audio-only'), SLOW).toBeVisible();
		expect(screen.container.querySelector('[data-testid="media-captions"]')).toBeNull();
	});
});

describe('the shelf', () => {
	async function keyOf(file: TpMediaFile): Promise<string> {
		const key = await resumeKey(file.name, file.size);
		if (key === null) throw new Error('the test browser hashes');
		return key;
	}

	// Each with a name of its own: a player's last still is written after its
	// teardown, and could land under the next test's key if they shared one.
	it('keeps a small JPEG still of where it paused', async () => {
		const file = await fixture(clipUrl, 'dừng.webm', 'video/webm');
		const screen = render(TpMediaPlayer, { file });
		const video = await playing(screen);
		await vi.waitFor(() => expect(video.currentTime).toBeGreaterThan(0.5), SLOW);

		await screen.getByTestId('media-toggle').click();

		const key = await keyOf(file);
		await vi.waitFor(async () => expect(await loadPoster(key)).not.toBeNull(), SLOW);
		const still = await loadPoster(key);
		expect(still?.type).toBe('image/jpeg');
		expect(still?.size).toBeLessThanOrEqual(POSTER_MAX_BYTES);
	});

	it('keeps a still when it goes, and none of the end', async () => {
		const file = await fixture(clipUrl, 'hết.webm', 'video/webm');
		const first = render(TpMediaPlayer, { file });
		const video = await playing(first);
		video.currentTime = 13.4;
		await vi.waitFor(() => expect(video.ended).toBe(true), SLOW);
		await vi.waitFor(async () => expect(await kept(file)).toBe(0), SLOW);
		const key = await keyOf(file);
		expect(await loadPoster(key)).toBeNull();

		cleanup();
		const again = render(TpMediaPlayer, { file });
		const replay = await playing(again);
		await vi.waitFor(() => expect(replay.currentTime).toBeGreaterThan(0.5), SLOW);
		cleanup();

		await vi.waitFor(async () => expect(await loadPoster(key)).not.toBeNull(), SLOW);
	});

	it('remembers a video opened through the picker, and not one from the input', async () => {
		const bytes = await (await fetch(clipUrl)).arrayBuffer();
		const folder = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle('tp-media-player', { create: true });
		try {
			const handle = await folder.getFileHandle('từ picker.webm', { create: true });
			const writable = await handle.createWritable();
			await writable.write(bytes);
			await writable.close();
			const picked = await handle.getFile();
			const fromPicker: TpMediaFile = {
				name: picked.name,
				size: picked.size,
				file: picked,
				handle
			};
			const fromInput = await fixture(clipUrl, 'từ input.webm', 'video/webm');

			const one = render(TpMediaPlayer, { file: fromPicker });
			await vi.waitFor(() => expect(phase(one.container)).toBe('ready'), SLOW);
			cleanup();
			const two = render(TpMediaPlayer, { file: fromInput });
			await vi.waitFor(() => expect(phase(two.container)).toBe('ready'), SLOW);

			const pickedKey = await keyOf(fromPicker);
			await vi.waitFor(async () => {
				const row = await db.fsaHandles.get(`media:${pickedKey}`);
				expect(row !== undefined && 'name' in row ? row.name : null).toBe('từ picker.webm');
			}, SLOW);
			expect(await db.fsaHandles.get(`media:${await keyOf(fromInput)}`)).toBeUndefined();
		} finally {
			await (
				await navigator.storage.getDirectory()
			).removeEntry('tp-media-player', {
				recursive: true
			});
		}
	});
});
