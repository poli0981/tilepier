import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { collection } from './collection.svelte';
import { saveMusicRoot } from './library';
import { player } from './player.svelte';
import oneUrl from './__fixtures__/library/Artist A/Album 1/01 One.mp3?url';
import threeUrl from './__fixtures__/library/Artist B/Three.ogg?url';

/**
 * The library store the tile and the detail share (doc 09 §2): loading once,
 * the folder's grant, re-linking, and doc 05 §7's quota warning — over a real
 * Dexie, a real OPFS folder and the real tag worker.
 */

let target: TpDb;
let opfs: FileSystemDirectoryHandle;
let folderName: string;
let folder: FileSystemDirectoryHandle;

async function bytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

async function put(name: string, url: string): Promise<void> {
	const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
	await writable.write(await bytes(url));
	await writable.close();
}

beforeEach(async () => {
	target = createDb(`tp-collection-test-${crypto.randomUUID()}`);
	opfs = await navigator.storage.getDirectory();
	folderName = `tp-collection-${crypto.randomUUID()}`;
	folder = await opfs.getDirectoryHandle(folderName, { create: true });
	collection.reset(target);
	player.reset({ target });
});

afterEach(async () => {
	vi.restoreAllMocks();
	collection.reset();
	player.reset();
	target.close();
	await target.delete();
	await opfs.removeEntry(folderName, { recursive: true });
});

describe('loading', () => {
	it('reads the library once, in library order, with no folder yet', async () => {
		await target.tracks.bulkPut([
			{ id: 'z', source: 'blob', title: 'Zed', artist: 'B', album: '', addedAt: 1 },
			{ id: 'y', source: 'blob', title: 'Why', artist: 'A', album: '', addedAt: 2 }
		]);
		const reads = vi.spyOn(target.tracks, 'toArray');

		await Promise.all([collection.load(), collection.load()]);

		expect(collection.loaded).toBe(true);
		expect(collection.tracks.map((track) => track.id)).toEqual(['y', 'z']);
		expect(collection.folder).toBe('none');
		expect(reads).toHaveBeenCalledTimes(1);
	});

	it('fails closed, and a retry reads again', async () => {
		vi.spyOn(target.tracks, 'toArray').mockRejectedValueOnce(new Error('blocked'));

		await collection.load();
		expect(collection.failed).toBe(true);
		expect(collection.loaded).toBe(true);

		await collection.retry();
		expect(collection.failed).toBe(false);
	});
});

describe('the folder (doc 09 §2, path A)', () => {
	it('scans the folder the picker returns, and asks to keep the storage', async () => {
		await put('one.mp3', oneUrl);
		vi.stubGlobal('showDirectoryPicker', async () => folder);
		const persist = vi.spyOn(navigator.storage, 'persist').mockResolvedValue(true);
		await collection.load();

		await collection.pickFolder();

		expect(persist).toHaveBeenCalledTimes(1);
		expect(collection.folder).toBe('granted');
		expect(collection.tracks.map((track) => track.title)).toEqual(['Một']);
		expect(collection.summary).toMatchObject({ added: 1 });
		expect(collection.scanning).toBeNull();
		vi.unstubAllGlobals();
	});

	it('does nothing when the reader closes the picker', async () => {
		vi.stubGlobal('showDirectoryPicker', async () => {
			throw new DOMException('closed', 'AbortError');
		});
		await collection.load();

		await collection.pickFolder();

		expect(collection.folder).toBe('none');
		expect(collection.summary).toBeNull();
		vi.unstubAllGlobals();
	});

	it('needs a re-link when the grant lapsed, and one click brings it back and plays', async () => {
		await saveMusicRoot(folder, target);
		await target.tracks.put({
			id: 'f',
			source: 'fsa',
			relPath: 'one.mp3',
			title: 'One',
			artist: '',
			album: '',
			addedAt: 1
		});
		vi.spyOn(FileSystemHandle.prototype, 'queryPermission').mockResolvedValue('prompt');
		const request = vi
			.spyOn(FileSystemHandle.prototype, 'requestPermission')
			.mockResolvedValue('granted');
		await collection.load();
		expect(collection.needsRelink).toBe(true);

		player.current = (await target.tracks.get('f')) ?? null;
		const play = vi.spyOn(player, 'play').mockImplementation(() => {});
		await collection.relink();

		expect(request).toHaveBeenCalledTimes(1);
		expect(collection.folder).toBe('granted');
		expect(collection.needsRelink).toBe(false);
		expect(play).toHaveBeenCalledTimes(1);
	});

	it('needs no re-link for a library of imported songs alone', async () => {
		await saveMusicRoot(folder, target);
		await target.tracks.put({
			id: 'b',
			source: 'blob',
			title: 'B',
			artist: '',
			album: '',
			addedAt: 1
		});
		vi.spyOn(FileSystemHandle.prototype, 'queryPermission').mockResolvedValue('prompt');

		await collection.load();

		expect(collection.needsRelink).toBe(false);
	});
});

describe('importing (doc 09 §2, path B)', () => {
	async function file(url: string, name: string): Promise<File> {
		return new File([await bytes(url)], name, { lastModified: 1_700_000_000_000 });
	}

	it('adds the files and lists them', async () => {
		await collection.load();

		await collection.importFiles([await file(threeUrl, 'Three.ogg')]);

		expect(collection.tracks.map((track) => track.title)).toEqual(['Ba']);
		expect(collection.summary).toMatchObject({ added: 1 });
	});

	it('waits for a second yes past doc 05 §7’s 80 % line', async () => {
		vi.spyOn(navigator.storage, 'estimate').mockResolvedValue({ usage: 79, quota: 100 });
		await collection.load();
		const picked = [await file(threeUrl, 'Three.ogg')];

		await collection.importFiles(picked);
		expect(collection.pendingImport).toEqual(picked);
		expect(collection.tracks).toEqual([]);

		await collection.confirmImport();
		expect(collection.pendingImport).toBeNull();
		expect(collection.tracks).toHaveLength(1);
	});

	it('drops a held import the reader declines', async () => {
		vi.spyOn(navigator.storage, 'estimate').mockResolvedValue({ usage: 99, quota: 100 });
		await collection.load();
		await collection.importFiles([await file(threeUrl, 'Three.ogg')]);

		collection.dismissImport();

		expect(collection.pendingImport).toBeNull();
		await collection.confirmImport();
		expect(collection.tracks).toEqual([]);
	});
});

describe('what the player learns', () => {
	it('reaches the list the tile and detail show', async () => {
		await target.tracks.put({
			id: 'a',
			source: 'blob',
			title: 'A',
			artist: '',
			album: '',
			addedAt: 1
		});
		await collection.load();

		// No bytes behind it: the player marks it missing on its way past.
		player.playTracks(['a'], 'a', { kind: 'library' });

		await vi.waitFor(() => expect(collection.tracks[0]?.missing).toBe(true));
	});
});

describe('orphaned imports (plan S25)', () => {
	it('shows audio a restore left without tracks, and deletes it only when asked', async () => {
		await target.tracks.put({
			id: 'kept',
			source: 'blob',
			title: 'Kept',
			artist: '',
			album: '',
			addedAt: 1
		});
		await target.trackBlobs.bulkPut([
			{ id: 'kept', blob: new Blob(['1']) },
			{ id: 'left', blob: new Blob(['123']) }
		]);

		await collection.load();
		expect(collection.orphans).toEqual({ ids: ['left'], bytes: 3 });
		// Loading reads; it never deletes.
		expect(await target.trackBlobs.count()).toBe(2);

		await collection.deleteOrphans();

		expect(collection.orphans.ids).toEqual([]);
		expect(await target.trackBlobs.get('left')).toBeUndefined();
		expect(await target.trackBlobs.get('kept')).toBeDefined();
	});

	it('reads an imported track with no audio here as missing, removable like the rest', async () => {
		await target.tracks.put({
			id: 'elsewhere',
			source: 'blob',
			title: 'Elsewhere',
			artist: '',
			album: '',
			addedAt: 1
		});

		await collection.load();
		expect(collection.missingCount).toBe(1);

		await collection.removeMissing();
		expect(await target.tracks.count()).toBe(0);
	});
});
