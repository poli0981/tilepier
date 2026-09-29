import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Spike S2 — music library ingestion (doc 22 §S2).
 *
 * **What is automated and what is not.** Path B (file import) is driven end to
 * end here, including the 200-file scan and its timing. Path A (File System
 * Access) is driven from the moment the picker returns: `showDirectoryPicker()`
 * opens an OS folder dialog that no automation can operate, so since Week 7
 * (spike S7) it is stubbed to hand back a real OPFS folder — see the S7 block
 * below. What stays manual is exactly what that stub cannot be: the dialog
 * itself, the user gesture `requestPermission` needs, a grant surviving a
 * browser restart, and Chrome revoking one in a background tab. The harness at
 * /spike/s2 exists to make those a few minutes' work on real hardware. Saying
 * so plainly beats a green suite that quietly tested neither.
 *
 * The fixtures are real WAV files rather than random bytes, because the point
 * is to exercise music-metadata's parser: a scan of 200 unparseable files
 * measures error handling, not tag parsing.
 */

const FILE_COUNT = 200;

/** Minimal but valid 8-bit mono WAV — music-metadata reads its header. */
function makeWav(seconds: number, sampleRate = 8000): Buffer {
	const samples = Math.floor(seconds * sampleRate);
	const data = Buffer.alloc(samples);
	for (let i = 0; i < samples; i++) {
		// A quiet sine so the file is not a block of identical bytes.
		data[i] = 128 + Math.round(40 * Math.sin((i / sampleRate) * 2 * Math.PI * 220));
	}

	const header = Buffer.alloc(44);
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + data.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16); // PCM chunk size
	header.writeUInt16LE(1, 20); // format: PCM
	header.writeUInt16LE(1, 22); // channels
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate, 28); // byte rate
	header.writeUInt16LE(1, 32); // block align
	header.writeUInt16LE(8, 34); // bits per sample
	header.write('data', 36);
	header.writeUInt32LE(data.length, 40);

	return Buffer.concat([header, data]);
}

let fixtureDir: string;
let fixturePaths: string[];

test.beforeAll(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), 'tp-s2-'));
	fixturePaths = [];
	for (let i = 0; i < FILE_COUNT; i++) {
		const path = join(fixtureDir, `track-${String(i).padStart(3, '0')}.wav`);
		// Vary the length so durations differ and the parser has real work.
		writeFileSync(path, makeWav(0.25 + (i % 8) * 0.05));
		fixturePaths.push(path);
	}
});

test.afterAll(() => {
	rmSync(fixtureDir, { recursive: true, force: true });
});

test.describe('S2 · import path (every browser)', () => {
	test(`scans ${FILE_COUNT} files in under 10 s with the UI still responsive`, async ({ page }) => {
		await page.goto('/spike/s2');
		await expect(page.getByTestId('status')).toHaveText('idle');

		const ticksBefore = Number(await page.getByTestId('ui-ticks').innerText());

		await page.getByTestId('import').setInputFiles(fixturePaths);
		await expect(page.getByTestId('status')).toHaveText('done', { timeout: 60_000 });

		await expect(page.getByTestId('track-count')).toHaveText(String(FILE_COUNT));

		// doc 22 §S2: "200 files scanned < 10 s with UI responsive".
		const elapsed = Number(await page.getByTestId('elapsed').innerText());
		expect(elapsed, `scan took ${elapsed} ms`).toBeLessThan(10_000);

		// The rAF counter must have kept advancing throughout. A main-thread
		// parse would have frozen it — this is what makes "responsive" a
		// measurement rather than a claim.
		const ticksAfter = Number(await page.getByTestId('ui-ticks').innerText());
		expect(ticksAfter - ticksBefore, 'the UI thread stalled during the scan').toBeGreaterThan(10);
	});

	test('parsed metadata is persisted, not just displayed', async ({ page }) => {
		await page.goto('/spike/s2');
		await page.getByTestId('import').setInputFiles(fixturePaths.slice(0, 20));
		await expect(page.getByTestId('status')).toHaveText('done', { timeout: 60_000 });

		const stored = await page.evaluate(async () => {
			const request = indexedDB.open('tilepier');
			const dbHandle = await new Promise<IDBDatabase>((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const tx = dbHandle.transaction('tracks', 'readonly');
			const all = await new Promise<unknown[]>((resolve, reject) => {
				const req = tx.objectStore('tracks').getAll();
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});
			dbHandle.close();
			return all as { title: string; source: string; durationMs?: number }[];
		});

		expect(stored.length).toBe(20);
		expect(stored.every((t) => t.source === 'blob')).toBe(true);
		// Durations come from the WAV header — proof the parser ran rather than
		// the filename fallback being all we got.
		expect(stored.filter((t) => (t.durationMs ?? 0) > 0).length).toBe(20);
		expect(stored.every((t) => t.title.startsWith('track-'))).toBe(true);
	});

	test('a quota estimate is available before importing', async ({ page }) => {
		// doc 05 §7: the number shown in Settings → Storage, and the basis for
		// the pre-import warning.
		await page.goto('/spike/s2');
		await expect(page.getByTestId('quota')).not.toHaveText('quota estimate unavailable');
		await expect(page.getByTestId('quota')).toContainText('MB');
	});

	test('a fresh profile reports no stored folder handle', async ({ page }) => {
		await page.goto('/spike/s2');
		await expect(page.getByTestId('has-handle')).toHaveText('no');
		await expect(page.getByTestId('permission')).toHaveText('none');
	});
});

test.describe('S2 · File System Access availability', () => {
	test('the API is present in Chromium, so path A is the default there', async ({ page }) => {
		await page.goto('/spike/s2');
		await expect(page.getByTestId('fsa-supported')).toHaveText('yes');

		// Feature detection must be a real check, not a user-agent sniff.
		const detected = await page.evaluate(() => ({
			picker: 'showDirectoryPicker' in window,
			handleProto: typeof FileSystemDirectoryHandle !== 'undefined',
			queryPermission:
				typeof FileSystemDirectoryHandle !== 'undefined' &&
				'queryPermission' in FileSystemDirectoryHandle.prototype
		}));
		expect(detected.picker).toBe(true);
		expect(detected.handleProto).toBe(true);
		expect(detected.queryPermission).toBe(true);
	});

	test('a directory handle survives a structured clone into IndexedDB', async ({ page }) => {
		// The persistence claim in doc 05 §3 rests on FileSystemDirectoryHandle
		// being structured-cloneable. That is checkable without a picker: clone
		// the OPFS root, which the same interface backs.
		await page.goto('/spike/s2');

		const result = await page.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			const request = indexedDB.open('tp-s2-handle-probe', 1);
			request.onupgradeneeded = () => request.result.createObjectStore('h');
			const dbHandle = await new Promise<IDBDatabase>((resolve, reject) => {
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});

			await new Promise<void>((resolve, reject) => {
				const tx = dbHandle.transaction('h', 'readwrite');
				tx.objectStore('h').put(root, 'root');
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			const readBack = await new Promise<unknown>((resolve, reject) => {
				const tx = dbHandle.transaction('h', 'readonly');
				const req = tx.objectStore('h').get('root');
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});

			dbHandle.close();
			indexedDB.deleteDatabase('tp-s2-handle-probe');

			return {
				isHandle: readBack instanceof FileSystemDirectoryHandle,
				kind: (readBack as FileSystemDirectoryHandle | undefined)?.kind ?? null
			};
		});

		expect(result.isHandle, 'a directory handle did not survive IndexedDB').toBe(true);
		expect(result.kind).toBe('directory');
	});
});

/**
 * Path A, driven after all (doc 22 §S7, plan S22).
 *
 * The picker opens an OS dialog no automation can operate, but what it returns
 * is an ordinary `FileSystemDirectoryHandle` — and OPFS hands out real ones.
 * So `showDirectoryPicker` is stubbed to return an OPFS folder filled with the
 * fixture library, and everything after the dialog is the real code: the walk,
 * `getFile()`, the worker, the handle kept in IndexedDB across a reload.
 *
 * OPFS always answers `granted`, so a grant that lapsed — a browser restart
 * without "Allow on every visit", or Chrome revoking it from a tab left in the
 * background — is simulated: `queryPermission` reads a flag in sessionStorage
 * (which survives the reload), and while the flag says `prompt` every handle
 * method the library uses throws `NotAllowedError`, as the real ones do. A
 * stub that only changed `queryPermission` would pass code that never looks
 * past it.
 */
const LIBRARY = join(process.cwd(), 'src', 'lib', 'widgets', 'music', '__fixtures__', 'library');
const LIBRARY_FILES = [
	'Artist A/Album 1/01 One.mp3',
	'Artist A/Album 1/02 Two.flac',
	'Artist A/Album 1/cover.png',
	'Artist A/Album 1/._01 One.mp3',
	'Artist B/Three.ogg',
	'.hidden/Skipped.mp3'
];

async function stubPicker(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const state = () => sessionStorage.getItem('tp-test-permission') ?? 'granted';
		const lapsed = () => new DOMException('The grant has lapsed.', 'NotAllowedError');

		window.showDirectoryPicker = async () =>
			(await navigator.storage.getDirectory()).getDirectoryHandle('music', { create: true });

		FileSystemHandle.prototype.queryPermission = async () => state() as PermissionState;
		FileSystemHandle.prototype.requestPermission = async () => {
			sessionStorage.setItem('tp-test-permission', 'granted');
			return 'granted';
		};

		const dir = FileSystemDirectoryHandle.prototype;
		const file = FileSystemFileHandle.prototype;
		for (const [proto, name] of [
			[dir, 'entries'],
			[dir, 'getDirectoryHandle'],
			[dir, 'getFileHandle'],
			[file, 'getFile']
		] as const) {
			const real = (proto as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
			Object.defineProperty(proto, name, {
				configurable: true,
				value(this: unknown, ...args: unknown[]) {
					if (state() !== 'granted') throw lapsed();
					return real?.apply(this, args);
				}
			});
		}
	});
}

/** Fills the OPFS folder the stubbed picker returns with the fixture library. */
async function fillOpfs(page: Page): Promise<void> {
	const files = LIBRARY_FILES.map((path) => ({
		path,
		base64: readFileSync(join(LIBRARY, path)).toString('base64')
	}));
	await page.evaluate(async (entries) => {
		const root = await (
			await navigator.storage.getDirectory()
		).getDirectoryHandle('music', {
			create: true
		});
		for (const { path, base64 } of entries) {
			const parts = path.split('/');
			const name = parts.pop() ?? '';
			let dir = root;
			for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
			const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
			await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
			await writable.close();
		}
	}, files);
}

async function storedTracks(page: Page): Promise<{ title: string; missing?: boolean }[]> {
	return page.evaluate(async () => {
		const request = indexedDB.open('tilepier');
		const dbHandle = await new Promise<IDBDatabase>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const rows = await new Promise<unknown[]>((resolve, reject) => {
			const req = dbHandle.transaction('tracks', 'readonly').objectStore('tracks').getAll();
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		dbHandle.close();
		return rows as { title: string; missing?: boolean }[];
	});
}

test.describe('S7 · path A through an OPFS folder', () => {
	test('a picked folder is scanned, and its handle outlives a reload', async ({ page }) => {
		await stubPicker(page);
		await page.goto('/spike/s2');
		await fillOpfs(page);

		await page.getByTestId('pick').click();
		await expect(page.getByTestId('status')).toHaveText('folder-saved');
		await page.getByTestId('scan').click();
		await expect(page.getByTestId('status')).toHaveText('done');

		// Three tracks: the image, the AppleDouble file and the hidden folder are
		// passed over, and none of them counts as a failure.
		await expect(page.getByTestId('summary')).toContainText(
			'added 3 · updated 0 · unchanged 0 · missing 0 · failed 0 · skipped dirs 0'
		);
		expect((await storedTracks(page)).map((track) => track.title).sort()).toEqual([
			'Ba',
			'Hai',
			'Một'
		]);

		await page.reload();
		await expect(page.getByTestId('has-handle')).toHaveText('yes');
		await expect(page.getByTestId('permission')).toHaveText('granted');
		await page.getByTestId('scan').click();
		await expect(page.getByTestId('summary')).toContainText('added 0 · updated 0 · unchanged 3');
	});

	test('a lapsed grant fails the scan at the root and marks nothing missing', async ({ page }) => {
		await stubPicker(page);
		await page.goto('/spike/s2');
		await fillOpfs(page);
		await page.getByTestId('pick').click();
		await page.getByTestId('scan').click();
		await expect(page.getByTestId('summary')).toContainText('added 3');

		await page.evaluate(() => sessionStorage.setItem('tp-test-permission', 'prompt'));
		await page.reload();
		await expect(page.getByTestId('permission')).toHaveText('prompt');

		await page.getByTestId('scan').click();
		await expect(page.getByTestId('status')).toHaveText('scan-failed-NotAllowedError');
		// An unreadable root must not turn the library "missing" (plan S9).
		expect((await storedTracks(page)).every((track) => track.missing !== true)).toBe(true);

		// Re-link — one click in real life — and the library is whole again.
		await page.getByTestId('relink').click();
		await expect(page.getByTestId('status')).toHaveText('permission-granted');
		await page.getByTestId('scan').click();
		await expect(page.getByTestId('summary')).toContainText('unchanged 3');
	});
});

test.describe('S7 · path B from a picked folder', () => {
	test('a folder import skips what is not music and keeps its paths', async ({ page }) => {
		await page.goto('/spike/s2');

		// Playwright fills `webkitRelativePath` itself for a directory (≥ 1.45).
		await page.getByTestId('import-folder').setInputFiles(LIBRARY);
		await expect(page.getByTestId('status')).toHaveText('done', { timeout: 60_000 });

		await expect(page.getByTestId('summary')).toContainText('added 3 · updated 0 · unchanged 0');
		await expect(page.getByTestId('summary')).toContainText('failed 0');
	});
});
