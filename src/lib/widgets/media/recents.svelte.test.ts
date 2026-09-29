import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type TpDb } from '$lib/core/storage/db';
import {
	forgetAllVideos,
	forgetVideo,
	readShelf,
	RECENTS_KEEP,
	rememberRecent,
	reopen
} from './recents';
import { savePoster, savePrefs, saveResume } from './resume';

/**
 * The shelf (doc 09 §3): the videos opened through the picker, kept by their
 * handles beside music's library folder; where each was left and its still;
 * the way back to one, which the browser may refuse or not find; and
 * forgetting — against real IndexedDB and real OPFS handles in the test
 * browser.
 */

const created: TpDb[] = [];
let opfs: FileSystemDirectoryHandle;
let folderName: string;
let folder: FileSystemDirectoryHandle;

function freshDb(): TpDb {
	const target = createDb(`tilepier-test-${crypto.randomUUID()}`);
	created.push(target);
	return target;
}

beforeEach(async () => {
	opfs = await navigator.storage.getDirectory();
	folderName = `tp-recents-${crypto.randomUUID()}`;
	folder = await opfs.getDirectoryHandle(folderName, { create: true });
});

afterEach(async () => {
	vi.restoreAllMocks();
	while (created.length > 0) await created.pop()?.delete();
	await opfs.removeEntry(folderName, { recursive: true });
});

async function video(name: string, content = 'frames'): Promise<FileSystemFileHandle> {
	const handle = await folder.getFileHandle(name, { create: true });
	const writable = await handle.createWritable();
	await writable.write(content);
	await writable.close();
	return handle;
}

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
const place = (name: string, positionMs = 60_000) => ({
	name,
	size: 6,
	positionMs,
	durationMs: 600_000
});

describe('rememberRecent', () => {
	it('keeps the newest five, and never touches the music library folder', async () => {
		const target = freshDb();
		await target.fsaHandles.put({ id: 'musicRoot', handle: folder });
		for (let index = 0; index < RECENTS_KEEP + 2; index += 1) {
			const name = `${String(index)}.webm`;
			await rememberRecent(
				`k${String(index)}`,
				{ name, size: 6, handle: await video(name) },
				10 + index,
				target
			);
		}

		const ids = (await target.fsaHandles.toCollection().primaryKeys()).sort();
		expect(ids).toEqual(['media:k2', 'media:k3', 'media:k4', 'media:k5', 'media:k6', 'musicRoot']);
	});
});

describe('readShelf', () => {
	it('offers the newest place worth coming back to, with its handle and still', async () => {
		const target = freshDb();
		await saveResume('old', place('Cũ.webm'), 1, target);
		await saveResume('mid', place('Giữa.webm'), 2, target);
		// Finished — put back to the start — so not worth offering.
		await saveResume('new', place('Mới.webm', 0), 3, target);
		await rememberRecent(
			'mid',
			{ name: 'Giữa.webm', size: 6, handle: await video('Giữa.webm') },
			5,
			target
		);
		await savePoster('mid', jpeg(), 5, target);

		const { last } = await readShelf(target);

		expect(last?.name).toBe('Giữa.webm');
		expect(last?.handle?.kind).toBe('file');
		expect(last?.poster?.type).toBe('image/jpeg');
	});

	it('lists the recents newest first, each with where it was left', async () => {
		const target = freshDb();
		await rememberRecent(
			'a',
			{ name: 'A.webm', size: 6, handle: await video('A.webm') },
			1,
			target
		);
		await rememberRecent(
			'b',
			{ name: 'B.webm', size: 6, handle: await video('B.webm') },
			2,
			target
		);
		await saveResume('a', place('A.webm', 90_000), 3, target);
		// A folder filed under a media: id is not a video, whatever the id says.
		await target.fsaHandles.put({ id: 'media:odd', handle: folder });

		const { recents } = await readShelf(target);

		expect(recents.map((row) => row.name)).toEqual(['B.webm', 'A.webm']);
		expect(recents[1]?.positionMs).toBe(90_000);
		expect(recents[0]?.durationMs).toBe(0);
	});

	it('is empty on a fresh profile', async () => {
		expect(await readShelf(freshDb())).toEqual({ last: null, recents: [] });
	});
});

describe('forgetting', () => {
	it('takes one video’s recent, place and still together, and nothing else', async () => {
		const target = freshDb();
		await target.playback.put({ id: 'music', updatedAt: 1, state: { positionMs: 5 } });
		await savePrefs({ volume: 0.5, muted: false }, 1, target);
		for (const key of ['a', 'b']) {
			await rememberRecent(
				key,
				{ name: `${key}.webm`, size: 6, handle: await video(`${key}.webm`) },
				1,
				target
			);
			await saveResume(key, place(`${key}.webm`), 1, target);
			await savePoster(key, jpeg(), 1, target);
		}

		await forgetVideo('a', target);

		expect((await target.fsaHandles.toCollection().primaryKeys()).sort()).toEqual(['media:b']);
		expect((await target.playback.toCollection().primaryKeys()).sort()).toEqual([
			'media:pos:b',
			'media:poster:b',
			'media:prefs',
			'music'
		]);
	});

	it('forgets every video, and keeps the volume and music’s rows', async () => {
		const target = freshDb();
		await target.fsaHandles.put({ id: 'musicRoot', handle: folder });
		await target.playback.put({ id: 'music', updatedAt: 1, state: { positionMs: 5 } });
		await savePrefs({ volume: 0.5, muted: false }, 1, target);
		await rememberRecent(
			'a',
			{ name: 'a.webm', size: 6, handle: await video('a.webm') },
			1,
			target
		);
		await saveResume('a', place('a.webm'), 1, target);
		await savePoster('a', jpeg(), 1, target);

		await forgetAllVideos(target);

		expect(await target.fsaHandles.toCollection().primaryKeys()).toEqual(['musicRoot']);
		expect((await target.playback.toCollection().primaryKeys()).sort()).toEqual([
			'media:prefs',
			'music'
		]);
	});
});

describe('reopen', () => {
	it('opens a file the browser still lets it read', async () => {
		const handle = await video('Phim.webm', 'khung hình');

		const result = await reopen(handle);

		expect(result.kind).toBe('opened');
		if (result.kind === 'opened') expect(result.file.name).toBe('Phim.webm');
	});

	it('asks first, and says so when the browser refuses', async () => {
		const handle = await video('Phim.webm');
		const read = vi.spyOn(handle, 'getFile');
		handle.requestPermission = vi.fn(async () => 'denied' as const);

		expect(await reopen(handle)).toEqual({ kind: 'denied' });
		expect(read).not.toHaveBeenCalled();
	});

	it('says so when the file is no longer where it was', async () => {
		const handle = await video('Phim.webm');
		await folder.removeEntry('Phim.webm');

		expect(await reopen(handle)).toEqual({ kind: 'missing' });
	});
});
