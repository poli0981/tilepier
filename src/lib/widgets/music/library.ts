import { db, type TpTrack } from '$lib/core/storage/db';
import type { TagResult } from './tag-worker';

/**
 * Music library ingestion — doc 09 §2, the target of spike S2.
 *
 * Two paths, both real:
 *
 *  - **A, File System Access (Chromium).** The user picks a folder once; the
 *    handle is persisted in Dexie and re-authorised with a single click on
 *    later visits. No audio bytes are ever copied — files stay on disk.
 *  - **B, file import (every browser).** A plain `<input type="file">`; audio
 *    is copied into Dexie. Costs quota, works everywhere.
 *
 * Feature detection picks the default; both can coexist (doc 09 §2).
 */

/** Extensions the scanner accepts (doc 09 §2). Not exported until a caller
 *  outside this module needs it. */
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'flac', 'ogg', 'opus', 'wav'] as const;

const FSA_ROOT_ID = 'musicRoot';

export function supportsFsa(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function isAudio(name: string): boolean {
	const ext = name.split('.').pop()?.toLowerCase();
	return !!ext && (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/** hash(path|name+size) — stable across sessions (doc 05 §4). */
async function trackId(key: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	return [...new Uint8Array(digest)]
		.slice(0, 12)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/* ─────────────────────────────────────────────────── path A: FSA handles */

export async function saveMusicRoot(handle: FileSystemDirectoryHandle): Promise<void> {
	// FileSystemDirectoryHandle is structured-cloneable, so IndexedDB can hold
	// it directly (doc 05 §3). It is a capability, not a path: it survives a
	// restart but the permission attached to it does not.
	await db.fsaHandles.put({ id: FSA_ROOT_ID, handle });
}

export async function loadMusicRoot(): Promise<FileSystemDirectoryHandle | null> {
	const row = await db.fsaHandles.get(FSA_ROOT_ID);
	return row?.handle ?? null;
}

export type FsaPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

/**
 * Checks a stored handle without prompting. `prompt` means the handle is
 * intact but needs a user gesture to re-authorise — that is the "Re-link
 * library" card in doc 09 §2, not an error.
 */
export async function queryRootPermission(
	handle: FileSystemDirectoryHandle
): Promise<FsaPermission> {
	if (typeof handle.queryPermission !== 'function') return 'unsupported';
	return (await handle.queryPermission({ mode: 'read' })) as FsaPermission;
}

/** Must be called from a user gesture — the browser requires it. */
export async function requestRootPermission(
	handle: FileSystemDirectoryHandle
): Promise<FsaPermission> {
	if (typeof handle.requestPermission !== 'function') return 'unsupported';
	return (await handle.requestPermission({ mode: 'read' })) as FsaPermission;
}

/** Walks the tree depth-first, yielding audio files with their relative paths. */
export async function* walkAudioFiles(
	dir: FileSystemDirectoryHandle,
	prefix = ''
): AsyncGenerator<{ relPath: string; file: File }> {
	for await (const [name, entry] of dir.entries()) {
		const relPath = prefix ? `${prefix}/${name}` : name;
		if (entry.kind === 'directory') {
			yield* walkAudioFiles(entry as FileSystemDirectoryHandle, relPath);
		} else if (isAudio(name)) {
			yield { relPath, file: await (entry as FileSystemFileHandle).getFile() };
		}
	}
}

/* ───────────────────────────────────────────────────────── shared ingest */

export interface ScanProgress {
	parsed: number;
	total: number;
}

/**
 * Parses a batch of files in the worker and writes metadata to Dexie.
 *
 * `storeBlobs` is the difference between the two paths: the FSA path keeps
 * audio on disk and stores metadata only, the import path copies the bytes in.
 * Cover art is deduped by content hash either way, so a 200-track album costs
 * one image rather than two hundred.
 */
export async function ingest(
	files: { relPath: string; file: File }[],
	options: { source: 'fsa' | 'blob'; storeBlobs: boolean; onProgress?: (p: ScanProgress) => void }
): Promise<TpTrack[]> {
	if (files.length === 0) return [];

	const worker = new Worker(new URL('./tag-worker.ts', import.meta.url), { type: 'module' });

	const byId = new Map<string, { relPath: string; file: File }>();
	const requests = await Promise.all(
		files.map(async (entry) => {
			const id = await trackId(`${entry.relPath}|${entry.file.size}`);
			byId.set(id, entry);
			return { id, file: entry.file };
		})
	);

	const tracks: TpTrack[] = [];
	const seenCovers = new Set<string>();

	await new Promise<void>((resolve, reject) => {
		worker.addEventListener('error', (e) => reject(new Error(e.message)));
		worker.addEventListener('message', (event: MessageEvent<TagResult | { done: true }>) => {
			const data = event.data;
			if ('done' in data) {
				resolve();
				return;
			}

			const entry = byId.get(data.id);
			if (!entry) return;

			const track: TpTrack = {
				id: data.id,
				source: options.source,
				title: data.title,
				artist: data.artist,
				album: data.album,
				addedAt: Date.now()
			};
			if (options.source === 'fsa') track.relPath = entry.relPath;
			if (data.durationMs != null) track.durationMs = data.durationMs;
			if (data.trackNo != null) track.trackNo = data.trackNo;
			if (data.year != null) track.year = data.year;
			if (data.coverHash) track.coverId = `cover:${data.coverHash}`;

			tracks.push(track);

			void (async () => {
				if (data.cover && data.coverHash && !seenCovers.has(data.coverHash)) {
					seenCovers.add(data.coverHash);
					await db.trackBlobs.put({ id: `cover:${data.coverHash}`, blob: data.cover });
				}
				if (options.storeBlobs) {
					await db.trackBlobs.put({ id: data.id, blob: entry.file });
				}
			})();

			options.onProgress?.({ parsed: tracks.length, total: files.length });
		});

		worker.postMessage(requests);
	});

	worker.terminate();
	await db.tracks.bulkPut(tracks);
	return tracks;
}

/* ─────────────────────────────────────────────────────────────── quota */

export interface QuotaEstimate {
	usageBytes: number;
	quotaBytes: number;
	ratio: number;
}

/** Shown in Settings → Storage, and before a large import (doc 05 §7). */
export async function estimateQuota(): Promise<QuotaEstimate | null> {
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
	const { usage = 0, quota = 0 } = await navigator.storage.estimate();
	return { usageBytes: usage, quotaBytes: quota, ratio: quota > 0 ? usage / quota : 0 };
}

/** doc 05 §7: warn before importing when projected usage passes 80 %. */
export function willExceedQuota(estimate: QuotaEstimate | null, incomingBytes: number): boolean {
	if (!estimate || estimate.quotaBytes === 0) return false;
	return (estimate.usageBytes + incomingBytes) / estimate.quotaBytes > 0.8;
}
