import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The File System Access pickers, driven after all (doc 22 §S7, Week 7 plan
 * S22) — shared by journey-music and journey-media.
 *
 * A picker opens an OS dialog no automation can operate, but what it returns is
 * an ordinary handle — and OPFS hands out real ones. So:
 * - `showDirectoryPicker` returns the OPFS folder `music/`;
 * - `showOpenFilePicker` returns the file in the OPFS folder `media/` that
 *   `chooseFile` last named, or throws `AbortError`, as a closed dialog does,
 *   when none is named.
 *
 * Everything after the dialog is the real code: the walk, `getFile()`, the
 * worker, the handle kept in IndexedDB across a reload.
 *
 * OPFS always answers `granted`, so a grant that lapsed — a browser restart
 * without "Allow on every visit", or Chrome revoking it from a tab left in the
 * background — is simulated: `queryPermission` reads a flag in sessionStorage
 * (which survives the reload), and while the flag says `prompt` every handle
 * method the app uses throws `NotAllowedError`, as the real ones do. A stub that
 * only changed `queryPermission` would pass code that never looks past it.
 * `lapseGrant` sets the flag.
 */

export async function stubPickers(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const state = () => sessionStorage.getItem('tp-test-permission') ?? 'granted';
		const lapsed = () => new DOMException('The grant has lapsed.', 'NotAllowedError');
		const folder = async (name: string) =>
			(await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });

		window.showDirectoryPicker = async () => folder('music');
		window.showOpenFilePicker = async () => {
			const name = sessionStorage.getItem('tp-test-pick');
			if (name === null) throw new DOMException('The reader closed it.', 'AbortError');
			return [await (await folder('media')).getFileHandle(name)];
		};

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

/** The next load finds every grant lapsed, as after a browser restart. */
export async function lapseGrant(page: Page): Promise<void> {
	await page.evaluate(() => sessionStorage.setItem('tp-test-permission', 'prompt'));
}

/** What the stubbed file picker returns from now on — a file in OPFS `media/`. */
export async function chooseFile(page: Page, name: string): Promise<void> {
	await page.evaluate((chosen) => sessionStorage.setItem('tp-test-pick', chosen), name);
}

/** Copies `paths`, relative to `root` on disk, into the OPFS folder `folder`. */
export async function fillOpfs(
	page: Page,
	folder: string,
	root: string,
	paths: readonly string[]
): Promise<void> {
	const files = paths.map((path) => ({
		path,
		base64: readFileSync(join(root, path)).toString('base64')
	}));
	await page.evaluate(
		async ([name, entries]) => {
			const top = await (
				await navigator.storage.getDirectory()
			).getDirectoryHandle(name, {
				create: true
			});
			for (const { path, base64 } of entries) {
				const parts = path.split('/');
				const leaf = parts.pop() ?? '';
				let dir = top;
				for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
				const writable = await (await dir.getFileHandle(leaf, { create: true })).createWritable();
				await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
				await writable.close();
			}
		},
		[folder, files] as const
	);
}
