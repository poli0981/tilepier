import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { resetPlayback } from '$lib/core/playback';
import { createDb, type TpDb } from '$lib/core/storage/db';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { collection } from './collection.svelte';
import { saveMusicRoot } from './library';
import { player } from './player.svelte';
import TpMusicWidget from './TpMusicWidget.svelte';

/**
 * The music tile (doc 09 §2) in the browser project: its states, its layouts
 * by `w` and `h`, and that its buttons drive the one player. The `<audio>` is a
 * stand-in that plays when asked; the library is a throwaway Dexie.
 */

class QuietAudio extends EventTarget {
	preload = '';
	volume = 1;
	currentTime = 0;
	duration = Number.NaN;
	paused = true;
	error = null;
	src = '';
	async play(): Promise<void> {
		this.paused = false;
		this.dispatchEvent(new Event('playing'));
	}
	pause(): void {
		if (this.paused) return;
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
	}
}

const WIDE: TpTileSize = { w: 4, h: 2, pxW: 420, pxH: 140, tier: 'L' };
const ROW: TpTileSize = { w: 4, h: 1, pxW: 420, pxH: 44, tier: 'L' };
const TINY: TpTileSize = { w: 2, h: 1, pxW: 200, pxH: 44, tier: 'S' };

let target: TpDb;

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	target = createDb(`tp-music-tile-${crypto.randomUUID()}`);
	collection.reset(target);
	player.reset({ target, createAudio: () => new QuietAudio() as unknown as HTMLAudioElement });
});

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	collection.reset();
	player.reset();
	resetPlayback();
	settings.dispose();
	target.close();
	await target.delete();
});

async function seed(titles: string[]): Promise<void> {
	for (const [index, title] of titles.entries()) {
		const id = `t${String(index)}`;
		await target.tracks.put({ id, source: 'blob', title, artist: '', album: '', addedAt: index });
		await target.trackBlobs.put({ id, blob: new Blob([id]) });
	}
}

function show(size: TpTileSize, over: Record<string, unknown> = {}) {
	const box = document.createElement('div');
	box.style.cssText = `width: ${String(size.pxW)}px; height: ${String(size.pxH)}px;`;
	document.body.appendChild(box);
	return render(TpMusicWidget, {
		target: box,
		props: { instanceId: 'wgt_music', settings: {}, size, ...over }
	});
}

describe('states (doc 06 §3)', () => {
	it('shows how to add music to an empty library, and that it stays on the device', async () => {
		const screen = show({ ...WIDE, h: 3, pxH: 216 });

		await expect.element(screen.getByTestId('music-empty')).toBeVisible();
		await expect.element(screen.getByText(m['widget.music.empty']())).toBeVisible();
		// Chromium can keep a folder, so choosing one is offered first.
		await expect.element(screen.getByTestId('music-pick')).toBeVisible();
		await expect.element(screen.getByTestId('music-add-files')).toBeInTheDocument();
		await expect
			.element(screen.getByText(m['widget.music.local_note'](), { exact: false }))
			.toBeVisible();
	});

	it('offers one way in on a one-row tile: the detail', async () => {
		const onOpenDetail = vi.fn();
		const screen = show(ROW, { onOpenDetail });

		const add = screen.getByRole('button', { name: m['widget.music.add_files']() });
		await expect.element(add).toBeVisible();
		await add.click();

		expect(onOpenDetail).toHaveBeenCalledTimes(1);
	});

	it('asks for the folder again when its grant has lapsed', async () => {
		const opfs = await navigator.storage.getDirectory();
		const name = `tp-music-tile-${crypto.randomUUID()}`;
		const folder = await opfs.getDirectoryHandle(name, { create: true });
		await saveMusicRoot(folder, target);
		await target.tracks.put({
			id: 'f',
			source: 'fsa',
			relPath: 'x.mp3',
			title: 'X',
			artist: '',
			album: '',
			addedAt: 1
		});
		vi.spyOn(FileSystemHandle.prototype, 'queryPermission').mockResolvedValue('prompt');
		const request = vi
			.spyOn(FileSystemHandle.prototype, 'requestPermission')
			.mockResolvedValue('granted');

		try {
			const screen = show(WIDE);
			await expect.element(screen.getByTestId('music-permission')).toBeVisible();

			await screen.getByTestId('music-relink').click();

			expect(request).toHaveBeenCalledTimes(1);
			await expect.element(screen.getByTestId('music-tile')).toBeVisible();
		} finally {
			await opfs.removeEntry(name, { recursive: true });
		}
	});

	it('says so when the library cannot be read, and tries again', async () => {
		vi.spyOn(target.tracks, 'toArray').mockRejectedValueOnce(new Error('blocked'));
		const screen = show(WIDE);

		await expect.element(screen.getByText(m['widget.music.error']())).toBeVisible();
		await screen.getByRole('button', { name: m['common.retry']() }).click();

		await expect.element(screen.getByTestId('music-empty')).toBeVisible();
	});
});

describe('the player on the tile', () => {
	it('starts the whole library from the top, and shows what plays next', async () => {
		// Seeded out of order: "the top" is the library's own order (artist,
		// album, track, title), not the order the rows were written in.
		await seed(['Bình', 'Anh']);
		const screen = show(WIDE);
		await expect
			.element(screen.getByText(m['widget.music.track_count']({ count: 2 })))
			.toBeVisible();

		await screen.getByTestId('music-toggle').click();

		await expect.element(screen.getByText('Anh', { exact: true })).toBeVisible();
		await expect
			.element(screen.getByText(m['widget.music.up_next']({ title: 'Bình' })))
			.toBeVisible();
		await expect
			.element(screen.getByTestId('music-toggle'))
			.toHaveAccessibleName(m['widget.music.pause']());
	});

	it('keeps previous and next off a 2×1 tile, where only play fits', async () => {
		await seed(['Một']);
		const screen = show(TINY);

		await expect.element(screen.getByTestId('music-toggle')).toBeVisible();
		expect(screen.container.querySelector('[data-testid="music-prev"]')).toBeNull();
		expect(screen.container.querySelector('[data-testid="music-next"]')).toBeNull();
	});

	it('marks a title too long for its box, so it can slide — or end in an ellipsis', async () => {
		await seed(['Một bài hát có cái tên dài đến mức một dòng của tile không chứa nổi']);
		const screen = show(TINY);
		await screen.getByTestId('music-toggle').click();

		const title = screen.container.querySelector<HTMLElement>('.tp-music__title');
		await vi.waitFor(() => expect(title?.dataset['overflow']).toBe('true'));
		expect(title?.style.getPropertyValue('--tp-marquee-shift')).toMatch(/^-\d+px$/);
	});
});
