import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Path A, driven after all (doc 22 §S7, Week 7 plan S22) — shared by the spike
 * harness's e2e and journey-music.
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
 * past it. `lapseGrant` sets the flag.
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

/** The three songs in it, as a file input takes them. */
export const LIBRARY_SONGS = [
	'Artist A/Album 1/01 One.mp3',
	'Artist A/Album 1/02 Two.flac',
	'Artist B/Three.ogg'
].map((path) => join(LIBRARY, path));

export async function stubPicker(page: Page): Promise<void> {
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

/** The next load finds the folder's grant lapsed, as after a browser restart. */
export async function lapseGrant(page: Page): Promise<void> {
	await page.evaluate(() => sessionStorage.setItem('tp-test-permission', 'prompt'));
}

/** Fills the OPFS folder the stubbed picker returns with the fixture library. */
export async function fillOpfs(page: Page): Promise<void> {
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
