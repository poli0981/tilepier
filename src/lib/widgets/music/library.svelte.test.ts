import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installLogBuffer, readLog } from '$lib/core/log-buffer';
import { createDb, type TpDb } from '$lib/core/storage/db';
import {
	createTagParser,
	forgetTracks,
	fileAt,
	importFiles,
	scanFolder,
	TpTagWorkerError,
	type TpTagParser
} from './library';
import oneUrl from './__fixtures__/library/Artist A/Album 1/01 One.mp3?url';
import twoUrl from './__fixtures__/library/Artist A/Album 1/02 Two.flac?url';
import threeUrl from './__fixtures__/library/Artist B/Three.ogg?url';
import notAudioUrl from './__fixtures__/formats/not-audio.mp3?url';
import taggedMp3Url from './__fixtures__/formats/tagged.mp3?url';
import taggedOggUrl from './__fixtures__/formats/tagged.ogg?url';
import twoCoversUrl from './__fixtures__/formats/two-covers.mp3?url';
import untaggedUrl from './__fixtures__/formats/untagged.mp3?url';

/**
 * doc 09 §2's two ingestion paths, plan S7/S9 — against a real Dexie, a real
 * OPFS folder (a genuine `FileSystemDirectoryHandle`, the kind a picker
 * returns) and the real tag worker, which the browser project serves.
 */

async function bytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
	return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

let target: TpDb;
let folder: FileSystemDirectoryHandle;
let opfs: FileSystemDirectoryHandle;
let folderName: string;

beforeEach(async () => {
	target = createDb(`tp-library-test-${crypto.randomUUID()}`);
	opfs = await navigator.storage.getDirectory();
	folderName = `tp-library-${crypto.randomUUID()}`;
	folder = await opfs.getDirectoryHandle(folderName, { create: true });
});

afterEach(async () => {
	vi.restoreAllMocks();
	target.close();
	await target.delete();
	await opfs.removeEntry(folderName, { recursive: true });
});

async function put(path: string, content: Uint8Array | string): Promise<void> {
	const parts = path.split('/');
	const name = parts.pop() ?? '';
	let dir = folder;
	for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
	const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
	await writable.write(typeof content === 'string' ? content : new Uint8Array(content));
	await writable.close();
}

async function drop(path: string): Promise<void> {
	const parts = path.split('/');
	const name = parts.pop() ?? '';
	let dir = folder;
	for (const part of parts) dir = await dir.getDirectoryHandle(part);
	await dir.removeEntry(name);
}

/** The fixture library, plus what a scan must pass over. */
async function seedLibrary(): Promise<void> {
	await put('Artist A/Album 1/01 One.mp3', await bytes(oneUrl));
	await put('Artist A/Album 1/02 Two.flac', await bytes(twoUrl));
	await put('Artist B/Three.ogg', await bytes(threeUrl));
	await put('Artist A/Album 1/cover.png', 'not audio, not counted');
	await put('Artist A/Album 1/._01 One.mp3', 'AppleDouble, skipped');
	await put('.hidden/Skipped.mp3', await bytes(untaggedUrl));
}

async function titles(): Promise<string[]> {
	return (await target.tracks.toArray()).map((track) => track.title).sort();
}

/** A parser that counts what it is asked to parse, over the real worker. */
function counting(): TpTagParser & { calls: number; names: string[] } {
	const real = createTagParser();
	const parser = {
		calls: 0,
		names: [] as string[],
		parse(file: File) {
			parser.calls += 1;
			parser.names.push(file.name);
			return real.parse(file);
		},
		dispose: () => real.dispose()
	};
	return parser;
}

/**
 * A folder that stands in for one whose subfolder `unreadable` refuses to be
 * listed — a Windows drive's `System Volume Information`, say — or, with
 * `root: true`, whose own listing fails, as an unplugged drive's does. OPFS
 * cannot refuse on its own, so this wraps a real OPFS folder.
 */
function refusing(
	real: FileSystemDirectoryHandle,
	options: { unreadable?: string; root?: boolean }
): FileSystemDirectoryHandle {
	function wrap(dir: FileSystemDirectoryHandle, path: string): FileSystemDirectoryHandle {
		const refuses = options.root === true ? path === '' : path === options.unreadable;
		return {
			kind: 'directory',
			name: dir.name,
			async *entries() {
				if (refuses) throw new DOMException('refused', 'NotAllowedError');
				for await (const [name, entry] of dir.entries()) {
					const child = path === '' ? name : `${path}/${name}`;
					yield [
						name,
						entry.kind === 'directory' ? wrap(entry as FileSystemDirectoryHandle, child) : entry
					] as [string, FileSystemHandle];
				}
			}
		} as unknown as FileSystemDirectoryHandle;
	}
	return wrap(real, '');
}

/** A real folder with one file left out of every listing. */
function hiding(real: FileSystemDirectoryHandle, hidden: string): FileSystemDirectoryHandle {
	function wrap(dir: FileSystemDirectoryHandle, path: string): FileSystemDirectoryHandle {
		return {
			kind: 'directory',
			name: dir.name,
			async *entries() {
				for await (const [name, entry] of dir.entries()) {
					const child = path === '' ? name : `${path}/${name}`;
					if (child === hidden) continue;
					yield [
						name,
						entry.kind === 'directory' ? wrap(entry as FileSystemDirectoryHandle, child) : entry
					] as [string, FileSystemHandle];
				}
			}
		} as unknown as FileSystemDirectoryHandle;
	}
	return wrap(real, '');
}

describe('scanFolder', () => {
	it('files what it finds, skips what it should, and resolves only once written', async () => {
		await seedLibrary();

		const summary = await scanFolder(folder, { target });

		expect(summary).toMatchObject({ added: 3, updated: 0, failed: 0, missing: 0, skippedDirs: 0 });
		// Everything it reports is already on disk the moment it resolves — the
		// spike's ingest() resolved with its writes still in flight.
		expect(await titles()).toEqual(['Ba', 'Hai', 'Một']);
		const three = (await target.tracks.toArray()).find((track) => track.title === 'Ba');
		expect(three).toMatchObject({
			source: 'fsa',
			relPath: 'Artist B/Three.ogg',
			artist: 'Artist B',
			// No album tag: empty, not a word of any language (the spike wrote
			// 'không rõ' into every library).
			album: ''
		});
		expect(three?.size).toBeGreaterThan(0);
		expect(three?.mtime).toBeGreaterThan(0);
	});

	it('leaves an unchanged library alone on a rescan, addedAt and all', async () => {
		await seedLibrary();
		await scanFolder(folder, { target });
		const before = await target.tracks.toArray();

		const parser = counting();
		const summary = await scanFolder(folder, { target, parser });
		parser.dispose();

		expect(summary).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
		// Nothing was parsed a second time, and nothing was re-stamped: the spike
		// reset addedAt on every scan, so "recently added" meant "recently scanned".
		expect(parser.calls).toBe(0);
		expect(await target.tracks.toArray()).toEqual(before);
	});

	it('parses a changed file again, under the same id and in the same place', async () => {
		await seedLibrary();
		await scanFolder(folder, { target });
		const [before] = await target.tracks.where('title').equals('Ba').toArray();

		// A tag edit: same path, different bytes, a different size.
		await put('Artist B/Three.ogg', await bytes(taggedOggUrl));
		const summary = await scanFolder(folder, { target });

		expect(summary).toMatchObject({ updated: 1, unchanged: 2, added: 0 });
		const after = await target.tracks.get(before?.id ?? '');
		expect(after?.title).toBe('Bài hát thử');
		// The id is the path, not the size — or every playlist holding this track
		// would have lost it to its own tag edit (plan S7).
		expect(after?.addedAt).toBe(before?.addedAt);
	});

	it('marks a file that has gone as missing, never deletes it, and unmarks it when it returns', async () => {
		await seedLibrary();
		await scanFolder(folder, { target });
		const two = await bytes(twoUrl);

		await drop('Artist A/Album 1/02 Two.flac');
		const gone = await scanFolder(folder, { target });
		expect(gone.missing).toBe(1);
		const [marked] = await target.tracks.where('title').equals('Hai').toArray();
		expect(marked?.missing).toBe(true);

		await put('Artist A/Album 1/02 Two.flac', two);
		await scanFolder(folder, { target });
		const [back] = await target.tracks.where('title').equals('Hai').toArray();
		expect(back?.missing).toBeUndefined();
		expect(back?.id).toBe(marked?.id);
	});

	it('unmarks a file that comes back untouched without parsing it again', async () => {
		// A drive that was unplugged and is back: same bytes, same time. The
		// wrapper hides one file for a scan, the way its absence would.
		await seedLibrary();
		await scanFolder(folder, { target });
		await scanFolder(hiding(folder, 'Artist B/Three.ogg'), { target });
		const [marked] = await target.tracks.where('title').equals('Ba').toArray();
		expect(marked?.missing).toBe(true);

		const parser = counting();
		const summary = await scanFolder(folder, { target, parser });
		parser.dispose();

		expect(summary).toMatchObject({ unchanged: 3, updated: 0 });
		expect(parser.calls).toBe(0);
		const [back] = await target.tracks.where('title').equals('Ba').toArray();
		expect(back?.missing).toBeUndefined();
	});

	it('skips a subfolder it cannot read, and calls nothing in it missing', async () => {
		await seedLibrary();
		await scanFolder(folder, { target });

		const summary = await scanFolder(refusing(folder, { unreadable: 'Artist A' }), { target });

		expect(summary).toMatchObject({ skippedDirs: 1, missing: 0, unchanged: 1 });
		expect((await target.tracks.toArray()).every((track) => track.missing === undefined)).toBe(
			true
		);
	});

	it('throws when the folder itself cannot be read, and marks nothing', async () => {
		// An unplugged drive, a lapsed grant: the whole library must not turn
		// "missing" because the root refused to be listed.
		await seedLibrary();
		await scanFolder(folder, { target });

		await expect(scanFolder(refusing(folder, { root: true }), { target })).rejects.toMatchObject({
			name: 'NotAllowedError'
		});
		expect((await target.tracks.toArray()).every((track) => track.missing === undefined)).toBe(
			true
		);
	});

	it('marks nothing missing from a scan that was cancelled', async () => {
		await seedLibrary();
		await scanFolder(folder, { target });
		await drop('Artist B/Three.ogg');

		const controller = new AbortController();
		const summary = await scanFolder(folder, {
			target,
			signal: controller.signal,
			onProgress: () => controller.abort()
		});

		expect(summary.cancelled).toBe(true);
		expect(summary.missing).toBe(0);
		const [three] = await target.tracks.where('title').equals('Ba').toArray();
		expect(three?.missing).toBeUndefined();
	});

	it('does not list a file named like audio that is not', async () => {
		await put('fake.mp3', await bytes(notAudioUrl));
		await put('real.mp3', await bytes(untaggedUrl));

		const summary = await scanFolder(folder, { target });

		expect(summary).toMatchObject({ added: 1, failed: 1 });
		expect(await titles()).toEqual(['real']);
	});

	it('stores a cover once for many tracks, and lets it go when nothing points at it', async () => {
		// Both files carry the same front cover.
		await put('a.mp3', await bytes(taggedMp3Url));
		await put('b.mp3', await bytes(twoCoversUrl));
		await scanFolder(folder, { target });

		const covers = () => target.trackBlobs.where(':id').startsWith('cover:').primaryKeys();
		expect(await covers()).toHaveLength(1);

		// Re-tagged without artwork: the cover is still held by b.mp3.
		await put('a.mp3', await bytes(untaggedUrl));
		await scanFolder(folder, { target });
		expect(await covers()).toHaveLength(1);

		await put('b.mp3', await bytes(untaggedUrl));
		await scanFolder(folder, { target });
		expect(await covers()).toHaveLength(0);
	});

	it('writes nothing about the files it read to the log', async () => {
		const uninstall = installLogBuffer({ version: 't', sha: 't', uaBrand: 't', locale: 'vi' });
		try {
			await seedLibrary();
			await put('Riêng tư/fake.mp3', await bytes(notAudioUrl));
			await scanFolder(folder, { target });
			await drop('Artist B/Three.ogg');
			await scanFolder(folder, { target });

			const log = JSON.stringify(readLog());
			for (const secret of ['Riêng tư', 'fake.mp3', 'Artist', 'Three', 'One.mp3', folderName]) {
				expect(log).not.toContain(secret);
			}
		} finally {
			uninstall();
		}
	});
});

describe('importFiles', () => {
	async function file(url: string, name: string, lastModified = 1_700_000_000_000): Promise<File> {
		return new File([await bytes(url)], name, { lastModified });
	}

	it('copies files in, and importing one twice keeps one track', async () => {
		const picked = [await file(oneUrl, '01 One.mp3'), await file(threeUrl, 'Three.ogg')];

		const first = await importFiles(picked, { target });
		expect(first).toMatchObject({ added: 2, unchanged: 0 });
		const ids = await target.tracks.toCollection().primaryKeys();
		// The audio itself is in the library on this path.
		for (const id of ids) expect(await target.trackBlobs.get(id)).toBeDefined();

		const again = await importFiles(picked, { target });
		expect(again).toMatchObject({ added: 0, unchanged: 2 });
		expect(await target.tracks.count()).toBe(2);
	});

	it('keeps two different files that share a name apart', async () => {
		// The spike keyed imports by name and size alone.
		const a = await file(untaggedUrl, 'Intro.mp3', 1_700_000_000_000);
		const b = await file(untaggedUrl, 'Intro.mp3', 1_700_000_500_000);

		const summary = await importFiles([a, b], { target });

		expect(summary.added).toBe(2);
		expect(await target.tracks.count()).toBe(2);
	});

	it('passes over files that are not music without calling them failures', async () => {
		const picked = [
			new File(['notes'], 'notes.txt'),
			new File(['apple double'], '._01 One.mp3'),
			await file(oneUrl, '01 One.mp3')
		];

		const summary = await importFiles(picked, { target });

		expect(summary).toMatchObject({ added: 1, failed: 0 });
	});

	it('stops at a full disk and keeps everything before it', async () => {
		const picked = [await file(oneUrl, '01 One.mp3'), await file(threeUrl, 'Three.ogg')];
		const put = target.trackBlobs.put.bind(target.trackBlobs);
		let audioWrites = 0;
		vi.spyOn(target.trackBlobs, 'put').mockImplementation((row, key) => {
			if (!String(row.id).startsWith('cover:') && (audioWrites += 1) === 2) {
				return Promise.reject(new DOMException('full', 'QuotaExceededError')) as never;
			}
			return put(row, key);
		});

		const summary = await importFiles(picked, { target });

		expect(summary).toMatchObject({ added: 1, quotaExceeded: true });
		// All or nothing per file: the second has no row without its bytes.
		expect(await titles()).toEqual(['Một']);
	});
});

describe('createTagParser', () => {
	/** A stand-in worker that answers only when told to. */
	class FakeWorker extends EventTarget {
		readonly posted: { id: string; file: File }[] = [];
		readonly terminate = vi.fn();
		postMessage(message: { id: string; file: File }): void {
			this.posted.push(message);
		}
		reply(data: unknown): void {
			this.dispatchEvent(new MessageEvent('message', { data }));
		}
	}

	it('gives up on a file that hangs, and starts the next on a fresh worker', async () => {
		const workers: FakeWorker[] = [];
		const parser = createTagParser({
			timeoutMs: 30,
			spawn: () => {
				const worker = new FakeWorker();
				workers.push(worker);
				return worker as unknown as Worker;
			}
		});

		const hung = await parser.parse(new File(['x'], 'hangs.mp3'));
		expect(hung).toEqual({ failed: 'unreadable' });
		expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);

		const next = parser.parse(new File(['y'], 'fine.mp3'));
		const fresh = workers[1];
		expect(fresh).toBeDefined();
		fresh?.reply({ id: 'other', tags: { title: 'not mine', artist: '', album: '' } });
		fresh?.reply({ id: fresh.posted[0]?.id, tags: { title: 'fine', artist: '', album: '' } });
		expect(await next).toEqual({ tags: { title: 'fine', artist: '', album: '' } });

		parser.dispose();
		expect(fresh?.terminate).toHaveBeenCalledTimes(1);
	});

	it('passes a category of failure through, and fails outright when the worker does', async () => {
		const worker = new FakeWorker();
		const parser = createTagParser({ spawn: () => worker as unknown as Worker });

		const notAudio = parser.parse(new File(['x'], 'x.mp3'));
		worker.reply({ id: worker.posted[0]?.id, failed: 'not-audio' });
		expect(await notAudio).toEqual({ failed: 'not-audio' });

		const broken = parser.parse(new File(['y'], 'y.mp3'));
		worker.dispatchEvent(new Event('error'));
		await expect(broken).rejects.toBeInstanceOf(TpTagWorkerError);
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});
});

describe('fileAt', () => {
	it('finds a track by its path, and says NotFoundError when it has moved', async () => {
		await put('Artist B/Three.ogg', await bytes(threeUrl));

		expect((await fileAt(folder, 'Artist B/Three.ogg')).name).toBe('Three.ogg');
		await expect(fileAt(folder, 'Artist B/Gone.ogg')).rejects.toMatchObject({
			name: 'NotFoundError'
		});
	});
});

describe('forgetTracks', () => {
	it('takes tracks, their bytes and their lone covers out, and leaves the files alone', async () => {
		await put('a.mp3', await bytes(taggedMp3Url));
		await put('b.mp3', await bytes(untaggedUrl));
		await scanFolder(folder, { target });
		const [withCover] = await target.tracks.where('title').equals('Bài hát thử').toArray();
		expect(withCover?.coverId).toBeDefined();

		await forgetTracks([withCover?.id ?? ''], target);

		expect(await target.tracks.count()).toBe(1);
		expect(await target.trackBlobs.where(':id').startsWith('cover:').count()).toBe(0);
		// Path A only ever reads: the file is still in the folder.
		expect((await fileAt(folder, 'a.mp3')).size).toBeGreaterThan(0);
	});
});
