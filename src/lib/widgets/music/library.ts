import { db as defaultDb, type TpDb, type TpTrack } from '$lib/core/storage/db';
import type { TpCover, TpTagReply, TpTagRequest, TpTags } from './tags';

/**
 * Music library ingestion — doc 09 §2, spike S2 and S7.
 *
 * Two paths, both real:
 *
 *  - **A, File System Access (Chromium).** The reader picks a folder once; the
 *    handle is kept in Dexie and re-authorised with one click on later visits.
 *    No audio bytes are copied — the files stay on disk, and a rescan diffs the
 *    folder against what the library already holds.
 *  - **B, file import (every browser).** A plain `<input type="file">`, with or
 *    without `webkitdirectory`; the audio is copied into Dexie. Costs quota,
 *    works everywhere.
 *
 * Both resolve only once everything they report has been written — the spike's
 * `ingest()` returned while its blob and cover writes were still in flight, so
 * a full disk surfaced nowhere (plan 1a.2). Each file is one transaction: its
 * cover, its bytes on path B, and its row, together or not at all.
 *
 * **Nothing about a reader's files is logged** — not a name, not a path. The
 * log ring buffer rides along with a bug report (doc 18), and a music library's
 * folder names are about as personal as the data in this app gets. The worker
 * reports a failure's category and never the parser's message for the same
 * reason. `library.svelte.test.ts` holds that line.
 */

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'flac', 'ogg', 'opus', 'wav']);

const FSA_ROOT_ID = 'musicRoot';

/**
 * How long one file may keep the worker before it is given up on (plan S9).
 * The worker parses one file at a time, so a file that hangs music-metadata
 * would otherwise stall the scan for good — and every rescan would meet it
 * again. Measured parses take milliseconds (doc 22 §S7); this is for the file
 * that never returns.
 */
const PARSE_TIMEOUT_MS = 20_000;

export function supportsFsa(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Hidden entries are skipped whole: dot-folders, and macOS's `._` AppleDouble
 * files, which carry audio extensions and hold nothing a parser can use.
 */
function isAudioName(name: string): boolean {
	if (name.startsWith('.')) return false;
	const dot = name.lastIndexOf('.');
	return dot > 0 && AUDIO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/* ─────────────────────────────────────────────────── path A: FSA handles */

export async function saveMusicRoot(
	handle: FileSystemDirectoryHandle,
	target: TpDb = defaultDb
): Promise<void> {
	// A FileSystemDirectoryHandle is structured-cloneable, so IndexedDB holds it
	// directly (doc 05 §3). It is a capability, not a path: it survives a
	// restart, but the permission attached to it does not.
	await target.fsaHandles.put({ id: FSA_ROOT_ID, handle });
}

export async function loadMusicRoot(
	target: TpDb = defaultDb
): Promise<FileSystemDirectoryHandle | null> {
	const row = await target.fsaHandles.get(FSA_ROOT_ID);
	return row?.handle ?? null;
}

export type FsaPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';

/**
 * Checks a stored handle without prompting. `prompt` means the handle is intact
 * but needs a user gesture to re-authorise — the "Re-link library" card of doc
 * 09 §2, not an error.
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

/** One audio file a walk found, by its path under the root. */
interface TpFoundFile {
	relPath: string;
	handle: FileSystemFileHandle;
}

/**
 * Every audio file under `root`, in path order, and the subfolders that could
 * not be read.
 *
 * **A subfolder that cannot be read is recorded and skipped; the root failing
 * throws** (plan S9). The spike's walker let the first unreadable folder reject
 * the whole scan — on a Windows drive, `System Volume Information` is one — and
 * the diff built on top has to know which folders it did *not* see, or it
 * would call everything in them missing.
 */
async function findAudioFiles(
	root: FileSystemDirectoryHandle,
	signal?: AbortSignal
): Promise<{ files: TpFoundFile[]; skippedDirs: string[] }> {
	const files: TpFoundFile[] = [];
	const skippedDirs: string[] = [];

	async function visit(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
		const entries: [string, FileSystemHandle][] = [];
		try {
			for await (const entry of dir.entries()) entries.push(entry);
		} catch (error) {
			if (prefix === '') throw error;
			skippedDirs.push(prefix);
			return;
		}

		for (const [name, entry] of entries) {
			if (signal?.aborted) return;
			if (name.startsWith('.')) continue;
			const relPath = prefix === '' ? name : `${prefix}/${name}`;
			if (entry.kind === 'directory') {
				await visit(entry as FileSystemDirectoryHandle, relPath);
			} else if (isAudioName(name)) {
				files.push({ relPath, handle: entry as FileSystemFileHandle });
			}
		}
	}

	await visit(root, '');
	files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
	return { files, skippedDirs };
}

/**
 * The file at `relPath` under `root` — how a track on path A is found again to
 * be played. Throws the browser's own `NotFoundError` for a file that has moved
 * and `NotAllowedError` for a grant that has lapsed, and the player tells the
 * two apart (plan S12).
 */
export async function fileAt(root: FileSystemDirectoryHandle, relPath: string): Promise<File> {
	const parts = relPath.split('/');
	const name = parts.pop() ?? '';
	let dir = root;
	for (const part of parts) dir = await dir.getDirectoryHandle(part);
	return (await dir.getFileHandle(name)).getFile();
}

/* ───────────────────────────────────────────────────────── the tag worker */

type TpParseOutcome = { tags: TpTags } | { failed: 'not-audio' | 'unreadable' };

export interface TpTagParser {
	parse(file: File): Promise<TpParseOutcome>;
	dispose(): void;
}

/** The worker could not be started or died on its own — not a file's fault,
 *  so the scan stops rather than filing every track as unreadable. */
export class TpTagWorkerError extends Error {
	override name = 'TpTagWorkerError';
}

/**
 * Parses tags in the worker, one file at a time (doc 20 §7).
 *
 * A file that takes longer than `timeoutMs` is answered `unreadable` and the
 * worker is replaced, so the next file starts on a fresh one. A worker that
 * fails on its own — its script would not load, say, offline before it was
 * ever cached — rejects with `TpTagWorkerError` instead.
 */
export function createTagParser(
	options: { timeoutMs?: number; spawn?: () => Worker } = {}
): TpTagParser {
	const timeoutMs = options.timeoutMs ?? PARSE_TIMEOUT_MS;
	const spawn =
		options.spawn ??
		(() => new Worker(new URL('./tag-worker.ts', import.meta.url), { type: 'module' }));
	let worker: Worker | null = null;
	let sequence = 0;

	function drop(): void {
		worker?.terminate();
		worker = null;
	}

	return {
		parse(file) {
			const current = (worker ??= spawn());
			const id = String((sequence += 1));

			return new Promise<TpParseOutcome>((resolve, reject) => {
				function settle(): void {
					clearTimeout(timer);
					current.removeEventListener('message', onMessage);
					current.removeEventListener('error', onError);
				}
				function onMessage(event: MessageEvent<TpTagReply>): void {
					if (event.data.id !== id) return;
					settle();
					resolve(
						'failed' in event.data ? { failed: event.data.failed } : { tags: event.data.tags }
					);
				}
				function onError(): void {
					settle();
					drop();
					reject(new TpTagWorkerError('the tag worker failed'));
				}
				const timer = setTimeout(() => {
					settle();
					drop();
					resolve({ failed: 'unreadable' });
				}, timeoutMs);

				current.addEventListener('message', onMessage);
				current.addEventListener('error', onError);
				current.postMessage({ id, file } satisfies TpTagRequest);
			});
		},
		dispose: drop
	};
}

/* ───────────────────────────────────────────────────────────── scanning */

export interface TpLibrarySummary {
	added: number;
	updated: number;
	unchanged: number;
	/** Tracks this scan newly found missing (path A only). */
	missing: number;
	/** Files that were not audio, or vanished between the walk and the read. */
	failed: number;
	/** Subfolders that could not be read, and whose tracks were left alone. */
	skippedDirs: number;
	cancelled: boolean;
	/** Path B stopped here: the next file would not fit (doc 05 §7). */
	quotaExceeded: boolean;
}

export interface TpScanOptions {
	signal?: AbortSignal;
	onProgress?: (progress: { done: number; total: number }) => void;
	/** The database to write to — the real one unless a test hands its own. */
	target?: TpDb;
	/** A parser to use instead of a fresh worker; the caller then disposes it. */
	parser?: TpTagParser;
}

function emptySummary(): TpLibrarySummary {
	return {
		added: 0,
		updated: 0,
		unchanged: 0,
		missing: 0,
		failed: 0,
		skippedDirs: 0,
		cancelled: false,
		quotaExceeded: false
	};
}

/**
 * Scans (or rescans) a picked folder into the library — doc 09 §2, plan S9.
 *
 * - A file the library already holds at the same size and modification time is
 *   left alone, `addedAt` and all; the spike re-parsed everything and reset it.
 * - A changed file is parsed again and updated in place, under the same id —
 *   which is the id scheme's whole point (plan S7): editing a track's tags
 *   changes its size, and a size in the id would have orphaned it from every
 *   playlist.
 * - A track that is no longer there is marked `missing`, never deleted, and
 *   **only when the folder that held it was read**. A root that cannot be read
 *   throws before anything is marked — an unplugged drive must not turn the
 *   whole library "missing".
 * - A cancelled scan marks nothing missing either: it has not seen everything.
 */
export async function scanFolder(
	root: FileSystemDirectoryHandle,
	options: TpScanOptions = {}
): Promise<TpLibrarySummary> {
	const target = options.target ?? defaultDb;
	const { files, skippedDirs } = await findAudioFiles(root, options.signal);
	const summary = emptySummary();
	summary.skippedDirs = skippedDirs.length;

	const existing = new Map(
		(await target.tracks.toArray())
			.filter((track) => track.source === 'fsa')
			.map((track) => [track.id, track])
	);
	const covers = await coverIds(target);
	const seen = new Set<string>();
	const parser = options.parser ?? createTagParser();

	try {
		for (const [index, found] of files.entries()) {
			if (options.signal?.aborted) {
				summary.cancelled = true;
				break;
			}

			const id = await trackIdOf(`fsa|${nfc(found.relPath)}`);
			seen.add(id);
			const prior = existing.get(id);

			let file: File;
			try {
				file = await found.handle.getFile();
			} catch {
				// Gone between the walk and the read. The next scan decides.
				summary.failed += 1;
				continue;
			}

			if (prior !== undefined && prior.size === file.size && prior.mtime === file.lastModified) {
				if (prior.missing === true) await target.tracks.put(present(prior));
				summary.unchanged += 1;
			} else {
				const outcome = await parser.parse(file);
				if ('failed' in outcome && outcome.failed === 'not-audio') {
					summary.failed += 1;
				} else {
					const tags = 'tags' in outcome ? outcome.tags : undefined;
					const track = trackOf(
						{ id, source: 'fsa', relPath: found.relPath },
						file,
						tags,
						prior?.addedAt ?? Date.now()
					);
					await store(target, track, tags?.cover, covers);
					if (prior === undefined) summary.added += 1;
					else summary.updated += 1;
				}
			}

			options.onProgress?.({ done: index + 1, total: files.length });
		}

		if (!summary.cancelled) {
			summary.missing = await markMissing(target, existing, seen, skippedDirs);
			await collectCovers(target);
		}
	} finally {
		if (options.parser === undefined) parser.dispose();
	}

	return summary;
}

/**
 * Copies picked files into the library — path B, doc 09 §2.
 *
 * A file already imported (same path, size and modification time) is skipped
 * rather than stored twice. A full disk stops the import where it is and says
 * so; every file before it is kept (doc 05 §7). Non-audio files in a picked
 * folder are passed over without counting as failures — a folder of music is
 * also a folder of cover images and playlists.
 */
export async function importFiles(
	files: readonly File[],
	options: TpScanOptions = {}
): Promise<TpLibrarySummary> {
	const target = options.target ?? defaultDb;
	const summary = emptySummary();
	const known = new Set((await target.tracks.toCollection().primaryKeys()) as string[]);
	const covers = await coverIds(target);
	const picked = files.filter((file) => {
		const path = file.webkitRelativePath || file.name;
		return isAudioName(file.name) && !path.split('/').some((part) => part.startsWith('.'));
	});
	const parser = options.parser ?? createTagParser();

	try {
		for (const [index, file] of picked.entries()) {
			if (options.signal?.aborted) {
				summary.cancelled = true;
				break;
			}

			const relPath = file.webkitRelativePath || file.name;
			const id = await trackIdOf(`blob|${nfc(relPath)}|${file.size}|${file.lastModified}`);

			if (known.has(id)) {
				summary.unchanged += 1;
			} else {
				const outcome = await parser.parse(file);
				if ('failed' in outcome && outcome.failed === 'not-audio') {
					summary.failed += 1;
				} else {
					const tags = 'tags' in outcome ? outcome.tags : undefined;
					const track = trackOf({ id, source: 'blob', relPath }, file, tags, Date.now());
					try {
						await store(target, track, tags?.cover, covers, file);
					} catch (error) {
						if (!isQuotaError(error)) throw error;
						summary.quotaExceeded = true;
						break;
					}
					known.add(id);
					summary.added += 1;
				}
			}

			options.onProgress?.({ done: index + 1, total: picked.length });
		}
	} finally {
		if (options.parser === undefined) parser.dispose();
	}

	return summary;
}

/**
 * Takes tracks out of the library — the detail's "remove missing": their rows,
 * any imported bytes they still hold, and then the covers nothing points at
 * any more. **Never the files on disk**: path A only ever reads the folder. A
 * playlist naming a forgotten id keeps it; the player skips ids it cannot find
 * (plan S25).
 */
export async function forgetTracks(
	ids: readonly string[],
	target: TpDb = defaultDb
): Promise<void> {
	if (ids.length === 0) return;
	await target.transaction('rw', target.tracks, target.trackBlobs, async () => {
		await target.tracks.bulkDelete([...ids]);
		await target.trackBlobs.bulkDelete([...ids]);
	});
	await collectCovers(target);
}

/* ─────────────────────────────────────────────────────────────── helpers */

/**
 * First twelve bytes of SHA-256 over `key`, as hex (plan S7):
 *
 * - path A: `fsa|<path>` — the path alone, so a tag edit (which changes the
 *   size) keeps the id, and moving the whole folder and picking it again
 *   finds every track where it was;
 * - path B: `blob|<path>|<size>|<mtime>` — an imported file has no stable path,
 *   so two different "01 Intro.mp3"s must not become one.
 *
 * Paths are NFC-normalised first: macOS hands out decomposed names, and the
 * same file seen composed and decomposed must be one track.
 */
async function trackIdOf(key: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	return [...new Uint8Array(digest)]
		.slice(0, 12)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function nfc(path: string): string {
	return path.normalize('NFC');
}

function trackOf(
	base: { id: string; source: TpTrack['source']; relPath: string },
	file: File,
	tags: TpTags | undefined,
	addedAt: number
): TpTrack {
	const track: TpTrack = {
		...base,
		// Unreadable tags still list the file — broken tags often play — under
		// its own name, the one piece of data it certainly has.
		title: tags?.title ?? file.name.replace(/\.[^.]+$/, '').normalize('NFC'),
		artist: tags?.artist ?? '',
		album: tags?.album ?? '',
		addedAt,
		size: file.size,
		mtime: file.lastModified
	};
	if (tags?.durationMs !== undefined) track.durationMs = tags.durationMs;
	if (tags?.trackNo !== undefined) track.trackNo = tags.trackNo;
	if (tags?.year !== undefined) track.year = tags.year;
	if (tags?.cover !== undefined) track.coverId = `cover:${tags.cover.hash}`;
	return track;
}

/** A track with its `missing` flag taken off — rebuilt, because under
 *  `exactOptionalPropertyTypes` a flag cannot be set to `undefined`. */
function present(track: TpTrack): TpTrack {
	const { missing: _missing, ...rest } = track;
	return rest;
}

async function coverIds(target: TpDb): Promise<Set<string>> {
	return new Set(
		(await target.trackBlobs.where(':id').startsWith('cover:').primaryKeys()) as string[]
	);
}

/** One file, all or nothing: its cover (once per image), its bytes on path B,
 *  and its row. */
async function store(
	target: TpDb,
	track: TpTrack,
	cover: TpCover | undefined,
	covers: Set<string>,
	audio?: Blob
): Promise<void> {
	await target.transaction('rw', target.tracks, target.trackBlobs, async () => {
		if (cover !== undefined && track.coverId !== undefined && !covers.has(track.coverId)) {
			await target.trackBlobs.put({ id: track.coverId, blob: cover.blob });
		}
		if (audio !== undefined) await target.trackBlobs.put({ id: track.id, blob: audio });
		await target.tracks.put(track);
	});
	if (track.coverId !== undefined) covers.add(track.coverId);
}

async function markMissing(
	target: TpDb,
	existing: ReadonlyMap<string, TpTrack>,
	seen: ReadonlySet<string>,
	skippedDirs: readonly string[]
): Promise<number> {
	const gone = [...existing.values()].filter(
		(track) =>
			!seen.has(track.id) &&
			track.missing !== true &&
			!skippedDirs.some((dir) => (track.relPath ?? '').startsWith(`${dir}/`))
	);
	if (gone.length > 0) {
		await target.tracks.bulkPut(gone.map((track) => ({ ...track, missing: true as const })));
	}
	return gone.length;
}

/**
 * Deletes covers no track points at any more (plan S8) — in one transaction
 * over both tables, so a write cannot slip in between the reading and the
 * deleting. Covers only: imported *audio* is never deleted behind the reader's
 * back (plan S25).
 */
async function collectCovers(target: TpDb): Promise<void> {
	await target.transaction('rw', target.tracks, target.trackBlobs, async () => {
		const referenced = new Set<string>();
		await target.tracks.each((track) => {
			if (track.coverId !== undefined) referenced.add(track.coverId);
		});
		const orphans = [...(await coverIds(target))].filter((id) => !referenced.has(id));
		if (orphans.length > 0) await target.trackBlobs.bulkDelete(orphans);
	});
}

function isQuotaError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	// Dexie re-raises IndexedDB's error under its own class, keeping the name
	// and the original as `inner`.
	const inner = (error as { inner?: unknown }).inner;
	return (
		error.name === 'QuotaExceededError' ||
		(inner instanceof Error && inner.name === 'QuotaExceededError')
	);
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
