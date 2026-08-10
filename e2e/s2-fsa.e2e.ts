import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Spike S2 — music library ingestion (doc 22 §S2).
 *
 * **What is automated and what is not.** Path B (file import) is driven end to
 * end here, including the 200-file scan and its timing. Path A (File System
 * Access) cannot be: `showDirectoryPicker()` opens an OS folder dialog that no
 * automation can operate, and there is no headless equivalent. Handle
 * persistence across a browser restart is therefore a manual check, and the
 * harness at /spike/s2 exists to make it a one-minute one. Saying so plainly
 * beats a green suite that quietly tested neither.
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
