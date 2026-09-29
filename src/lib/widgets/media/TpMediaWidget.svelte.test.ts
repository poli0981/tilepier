import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { resetPlayback } from '$lib/core/playback';
import { db } from '$lib/core/storage/db';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { rememberRecent } from './recents';
import { resumeKey, savePoster, saveResume } from './resume';
import { media } from './store.svelte';
import TpMediaDetail from './TpMediaDetail.svelte';
import TpMediaWidget from './TpMediaWidget.svelte';

/**
 * The video tile and the detail around the player (doc 09 §3): one click from
 * an empty tile opens a file and the detail; a tile with a video open shows
 * how far in it is; after a reload it offers the last video back; the detail
 * with nothing open offers the one way in.
 */

const DEFAULT: TpTileSize = { w: 4, h: 3, pxW: 420, pxH: 216, tier: 'L' };
const SMALL: TpTileSize = { w: 2, h: 2, pxW: 200, pxH: 140, tier: 'M' };
const FILE = new File(['frames'], 'Phim thử.mp4', { type: 'video/mp4' });

/** Media's rows only: music's, in the same tables, belong to other tests. */
async function forgetMedia(): Promise<void> {
	await db.playback.where('id').startsWith('media:').delete();
	await db.fsaHandles.where('id').startsWith('media:').delete();
}

const SHELF_FOLDER = 'tp-media-tile';

async function shelfFolder(): Promise<FileSystemDirectoryHandle> {
	return (await navigator.storage.getDirectory()).getDirectoryHandle(SHELF_FOLDER, {
		create: true
	});
}

/** A video in OPFS, as the File System Access picker hands one back. */
async function opfsVideo(name: string): Promise<FileSystemFileHandle> {
	const handle = await (await shelfFolder()).getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	await writable.write('frames');
	await writable.close();
	return handle;
}

/** What a video opened through the picker leaves: a recent, a place, a still. */
async function shelve(handle: FileSystemFileHandle, positionMs = 65_000): Promise<string> {
	const file = await handle.getFile();
	const key = await resumeKey(file.name, file.size);
	if (key === null) throw new Error('the test browser hashes');
	await rememberRecent(key, { name: file.name, size: file.size, handle });
	await saveResume(key, { name: file.name, size: file.size, positionMs, durationMs: 187_000 });
	await savePoster(key, new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }));
	return key;
}

beforeEach(async () => {
	settings.dispose();
	settings.hydrate();
	media.reset();
	await forgetMedia();
});

afterEach(async () => {
	cleanup();
	// Before the rows go: a test may have stood in for the table itself.
	vi.restoreAllMocks();
	await forgetMedia();
	await (
		await navigator.storage.getDirectory()
	)
		.removeEntry(SHELF_FOLDER, { recursive: true })
		.catch(() => undefined);
	media.reset();
	resetPlayback();
	settings.dispose();
	Reflect.deleteProperty(window, 'showOpenFilePicker');
});

function tile(size: TpTileSize, onOpenDetail = vi.fn()) {
	return {
		onOpenDetail,
		screen: render(TpMediaWidget, {
			props: { instanceId: 'wgt_media', settings: {}, size, onOpenDetail }
		})
	};
}

describe('TpMediaWidget', () => {
	it('offers to open a video, and says it stays on the device where there is room', async () => {
		const { screen } = tile(DEFAULT);

		await expect.element(screen.getByTestId('media-empty')).toBeVisible();
		await expect.element(screen.getByText(m['widget.media.local_note']())).toBeVisible();
	});

	it('keeps to one button on the smallest tile', async () => {
		const { screen } = tile(SMALL);

		await expect.element(screen.getByTestId('media-tile-open')).toBeVisible();
		expect(screen.container.textContent).not.toContain(m['widget.media.local_note']());
	});

	it('opens a video and its detail in one click', async () => {
		window.showOpenFilePicker = async () => [
			{ kind: 'file', name: FILE.name, getFile: async () => FILE } as FileSystemFileHandle
		];
		const { screen, onOpenDetail } = tile(DEFAULT);

		await screen.getByTestId('media-tile-open').click();

		await vi.waitFor(() => expect(onOpenDetail).toHaveBeenCalledOnce());
		expect(media.current?.name).toBe('Phim thử.mp4');
	});

	it('stays as it was when the reader closes the picker', async () => {
		window.showOpenFilePicker = async () => {
			throw new DOMException('closed', 'AbortError');
		};
		const { screen, onOpenDetail } = tile(DEFAULT);

		await screen.getByTestId('media-tile-open').click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(onOpenDetail).not.toHaveBeenCalled();
		expect(media.current).toBeNull();
	});

	it('after a reload, offers the last video back — the same file, picked again', async () => {
		const key = await resumeKey(FILE.name, FILE.size);
		if (key === null) throw new Error('the test browser hashes');
		await saveResume(key, {
			name: FILE.name,
			size: FILE.size,
			positionMs: 65_000,
			durationMs: 187_000
		});
		window.showOpenFilePicker = async () => [
			{ kind: 'file', name: FILE.name, getFile: async () => FILE } as FileSystemFileHandle
		];
		const { screen, onOpenDetail } = tile(DEFAULT);

		await expect.element(screen.getByText('Phim thử.mp4')).toBeVisible();
		await expect.element(screen.getByText('1:05 / 3:07')).toBeVisible();
		await expect.element(screen.getByText(m['widget.media.pick_again']())).toBeVisible();
		await screen.getByTestId('media-continue').click();

		await vi.waitFor(() => expect(onOpenDetail).toHaveBeenCalledOnce());
		expect(media.current?.name).toBe('Phim thử.mp4');
	});

	it('shows the tide, never a blank, while it reads where the reader was', async () => {
		// The shelf is read in one transaction: one that never settles.
		vi.spyOn(db, 'transaction').mockReturnValue(new Promise(() => {}) as never);
		const { screen } = tile(DEFAULT);

		await expect
			.element(screen.getByLabelText(m['widget.media.loading']()))
			.toHaveAttribute('aria-busy', 'true');
	});

	it('says when it cannot read where the reader was — and still opens a video', async () => {
		const where = vi.spyOn(db, 'transaction').mockImplementation(() => {
			throw new DOMException('closed', 'InvalidStateError');
		});
		const { screen } = tile(DEFAULT);

		await expect.element(screen.getByTestId('media-error')).toBeVisible();
		await expect.element(screen.getByTestId('media-tile-open')).toBeVisible();

		where.mockRestore();
		await screen.getByRole('button', { name: m['common.retry']() }).click();

		await expect.element(screen.getByTestId('media-empty')).toBeVisible();
	});

	it('after a reload, opens a video from the picker again from its handle, with its still', async () => {
		await shelve(await opfsVideo('Phim từ picker.webm'));
		const picker = vi.fn();
		window.showOpenFilePicker = picker;
		const { screen, onOpenDetail } = tile(DEFAULT);

		await expect.element(screen.getByText('Phim từ picker.webm')).toBeVisible();
		await expect.element(screen.getByTestId('media-still')).toBeVisible();
		// Not "pick it again": this one has a way back.
		expect(screen.container.textContent).not.toContain(m['widget.media.pick_again']());
		await screen.getByTestId('media-continue').click();

		await vi.waitFor(() => expect(onOpenDetail).toHaveBeenCalledOnce());
		expect(media.current?.name).toBe('Phim từ picker.webm');
		expect(media.current?.handle).toBeDefined();
		expect(picker).not.toHaveBeenCalled();
	});

	it('says so when the browser refuses a handle, and the next press picks instead', async () => {
		const handle = await opfsVideo('Bị từ chối.webm');
		await shelve(handle);
		vi.spyOn(FileSystemHandle.prototype, 'requestPermission').mockResolvedValue('denied');
		window.showOpenFilePicker = async () => [handle];
		const { screen, onOpenDetail } = tile(DEFAULT);
		await expect.element(screen.getByText('Bị từ chối.webm')).toBeVisible();

		await screen.getByTestId('media-continue').click();

		await expect.element(screen.getByTestId('media-tile-refused')).toBeVisible();
		expect(onOpenDetail).not.toHaveBeenCalled();
		await screen.getByTestId('media-continue').click();
		await vi.waitFor(() => expect(onOpenDetail).toHaveBeenCalledOnce());
	});

	it('shows the open video, how far in it is, and the way back to it', async () => {
		media.open({ name: FILE.name, size: FILE.size, file: FILE });
		media.report(65_000, 187_000, true);
		const { screen, onOpenDetail } = tile(DEFAULT);

		await expect.element(screen.getByText('Phim thử.mp4')).toBeVisible();
		await expect.element(screen.getByText('1:05 / 3:07')).toBeVisible();
		await screen.getByTestId('media-continue').click();

		expect(onOpenDetail).toHaveBeenCalledOnce();
	});
});

describe('TpMediaDetail', () => {
	function detail() {
		return render(TpMediaDetail, {
			props: { instanceId: 'wgt_media', settings: {}, close: () => {} }
		});
	}

	it('after a reload, with nothing open, offers the last video back', async () => {
		// A reload with the detail open lands on /w/media, not on the deck.
		const key = await resumeKey(FILE.name, FILE.size);
		if (key === null) throw new Error('the test browser hashes');
		await saveResume(key, {
			name: FILE.name,
			size: FILE.size,
			positionMs: 65_000,
			durationMs: 187_000
		});
		window.showOpenFilePicker = async () => [
			{ kind: 'file', name: FILE.name, getFile: async () => FILE } as FileSystemFileHandle
		];
		const screen = detail();

		await expect.element(screen.getByTestId('media-last')).toHaveTextContent('Phim thử.mp4');
		await expect.element(screen.getByText('1:05 / 3:07')).toBeVisible();
		await expect.element(screen.getByText(m['widget.media.pick_again']())).toBeVisible();
		await screen.getByTestId('media-last-continue').click();

		await vi.waitFor(() => expect(media.current?.name).toBe('Phim thử.mp4'));
	});

	it('lists the videos opened lately, forgets one, then all of them', async () => {
		await shelve(await opfsVideo('Một.webm'));
		await shelve(await opfsVideo('Hai.webm'), 0);
		const screen = detail();

		await expect.element(screen.getByTestId('media-recents')).toBeVisible();
		await expect.poll(() => screen.getByTestId('media-recent').all().length).toBe(2);
		await screen
			.getByRole('button', { name: m['widget.media.forget_named']({ name: 'Một.webm' }) })
			.click();

		await expect.poll(() => screen.getByTestId('media-recent').all().length).toBe(1);
		expect(screen.container.textContent).not.toContain('Một.webm');
		await screen.getByTestId('media-recents-forget-all').click();

		await expect.element(screen.getByTestId('media-recents')).not.toBeInTheDocument();
		expect(await db.fsaHandles.where('id').startsWith('media:').count()).toBe(0);
	});

	it('opens a recent from its handle, or says the file is gone', async () => {
		await shelve(await opfsVideo('Còn.webm'));
		const gone = await opfsVideo('Mất.webm');
		await shelve(gone);
		await (await shelfFolder()).removeEntry('Mất.webm');
		const screen = detail();
		await expect.poll(() => screen.getByTestId('media-recent').all().length).toBe(2);

		await screen
			.getByRole('button', { name: m['widget.media.open_recent']({ name: 'Mất.webm' }) })
			.click();
		await expect
			.element(screen.getByTestId('media-recent-trouble'))
			.toHaveTextContent(m['widget.media.recent_missing']());
		await screen
			.getByRole('button', { name: m['widget.media.open_recent']({ name: 'Còn.webm' }) })
			.click();

		await vi.waitFor(() => expect(media.current?.name).toBe('Còn.webm'));
	});

	it('with nothing open, offers the one way in', async () => {
		const screen = detail();

		await expect.element(screen.getByTestId('media-nothing')).toBeVisible();
		await expect.element(screen.getByTestId('media-open')).toBeVisible();
	});

	it('plays the open video, under its name, with a way to open another', async () => {
		media.open({ name: FILE.name, size: FILE.size, file: FILE });
		const screen = detail();

		await expect.element(screen.getByTestId('media-player')).toBeInTheDocument();
		await expect.element(screen.getByText('Phim thử.mp4')).toBeVisible();
		await expect.element(screen.getByTestId('media-open-another')).toBeVisible();
	});
});
