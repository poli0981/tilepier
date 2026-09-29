import { db as defaultDb, type TpDb, type TpTrack } from '$lib/core/storage/db';
import {
	deleteOrphans as deleteOrphanedAudio,
	estimateQuota,
	forgetTracks,
	importFiles as importIntoLibrary,
	loadMusicRoot,
	queryRootPermission,
	readLibrary,
	requestRootPermission,
	saveMusicRoot,
	scanFolder,
	willExceedQuota,
	type FsaPermission,
	type TpLibrarySummary,
	type TpOrphans
} from './library';
import { player } from './player.svelte';
import { libraryOrder } from './service';

/**
 * The library as the tile and the detail both see it (doc 09 §2).
 *
 * **One list for two components**, the way `map/places.svelte.ts` shares the
 * saved places: the repo has no `liveQuery`, and a tile that read Dexie once
 * would go on showing an empty library after the detail had scanned a
 * folder. It is loaded once per page and replaced wholesale after every scan
 * or import — `$state.raw`, because a library can be thousands of rows and
 * nothing edits one in place.
 *
 * The folder, its grant and the scans live here too, because both surfaces
 * start them: the tile's empty state picks the first folder, the detail
 * rescans.
 */

const NO_ORPHANS: TpOrphans = { ids: [], bytes: 0 };

/** A scan or import in progress, for the progress line. */
interface TpScanProgress {
	done: number;
	total: number;
}

/**
 * doc 05 §7: ask for persistent storage once the reader adds music. Called
 * first thing in the click, before any await — Firefox answers `persist()`
 * with a prompt of its own. Idempotent: a grant already given resolves
 * without asking again, and Chrome and Safari decide without asking at all.
 */
function requestPersistence(): void {
	const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
	if (typeof storage?.persist !== 'function') return;
	storage.persist().catch(() => undefined);
}

class TpCollection {
	tracks = $state.raw<readonly TpTrack[]>([]);
	loaded = $state(false);
	failed = $state(false);
	/** The folder's grant, or `'none'` while there is no folder. */
	folder = $state<'none' | FsaPermission>('none');
	scanning = $state.raw<TpScanProgress | null>(null);
	/** The last scan's or import's counts, or a root that could not be read. */
	summary = $state.raw<TpLibrarySummary | null>(null);
	scanFailed = $state(false);
	/** Files held back at doc 05 §7's 80 % line until the reader says go. */
	pendingImport = $state.raw<readonly File[] | null>(null);
	/** Imported audio a replacing restore left without tracks (plan S25). */
	orphans = $state.raw<TpOrphans>(NO_ORPHANS);

	#target: TpDb = defaultDb;
	#root: FileSystemDirectoryHandle | null = null;
	#loading: Promise<void> | null = null;
	#controller: AbortController | null = null;

	constructor() {
		player.onTrackChange((track) => {
			this.tracks = this.tracks.map((entry) => (entry.id === track.id ? track : entry));
		});
	}

	get hasFolderTracks(): boolean {
		return this.tracks.some((track) => track.source === 'fsa');
	}

	get missingCount(): number {
		return this.tracks.filter((track) => track.missing === true).length;
	}

	/** doc 09 §2's "Rescan reconciles" leaves missing tracks marked, never
	 *  deleted; this is the reader deciding they are gone. */
	async removeMissing(): Promise<void> {
		const ids = this.tracks.filter((track) => track.missing === true).map((track) => track.id);
		await forgetTracks(ids, this.#target);
		await this.#refresh();
	}

	/** doc 06 §3's `permission-needed`: a folder library the browser will
	 *  not read until the reader says so again. */
	get needsRelink(): boolean {
		return (this.folder === 'prompt' || this.folder === 'denied') && this.hasFolderTracks;
	}

	/** Reads the library once per page; later calls share the read. */
	load(): Promise<void> {
		this.#loading ??= this.#read();
		return this.#loading;
	}

	retry(): Promise<void> {
		this.#loading = null;
		this.loaded = false;
		return this.load();
	}

	async #read(): Promise<void> {
		try {
			await this.#refresh();
			this.#root = await loadMusicRoot(this.#target);
			this.folder = this.#root === null ? 'none' : await queryRootPermission(this.#root);
			this.failed = false;
		} catch {
			// Fail closed (doc 05 §5), and say nothing about the files in the log.
			this.failed = true;
		} finally {
			this.loaded = true;
		}
	}

	async #refresh(): Promise<void> {
		const { tracks, orphans } = await readLibrary(this.#target);
		this.tracks = libraryOrder(tracks);
		this.orphans = orphans;
	}

	/** Plan S25: the reader, and only the reader, deletes orphaned audio. */
	async deleteOrphans(): Promise<void> {
		await deleteOrphanedAudio(this.orphans.ids, this.#target);
		await this.#refresh();
	}

	/** Path A. Call from the click: the picker needs the gesture. */
	async pickFolder(): Promise<void> {
		requestPersistence();
		const picker = typeof window === 'undefined' ? undefined : window.showDirectoryPicker;
		if (picker === undefined) return;

		let root: FileSystemDirectoryHandle;
		try {
			root = await picker.call(window, { id: 'tilepier-music', mode: 'read' });
		} catch {
			return; // The reader closed the picker.
		}
		await saveMusicRoot(root, this.#target);
		this.#root = root;
		this.folder = 'granted';
		await this.#scan(root);
	}

	async rescan(): Promise<void> {
		if (this.#root !== null) await this.#scan(this.#root);
	}

	cancelScan(): void {
		this.#controller?.abort();
	}

	async #scan(root: FileSystemDirectoryHandle): Promise<void> {
		if (this.scanning !== null) return;
		const controller = new AbortController();
		this.#controller = controller;
		this.scanning = { done: 0, total: 0 };
		this.scanFailed = false;
		try {
			this.summary = await scanFolder(root, {
				target: this.#target,
				signal: controller.signal,
				onProgress: (progress) => {
					this.scanning = progress;
				}
			});
		} catch (error) {
			// The root itself would not be read (doc 09 §2): a lapsed grant, or
			// a drive that is gone. Nothing was marked missing.
			this.scanFailed = true;
			if ((error as { name?: unknown }).name === 'NotAllowedError') this.folder = 'prompt';
		} finally {
			this.scanning = null;
			this.#controller = null;
			await this.#refresh().catch(() => undefined);
		}
	}

	/**
	 * Re-authorises the folder (doc 09 §2's "Re-link library"). The grant is
	 * the first await, so the click's activation is still fresh for it; if the
	 * player had a track waiting, it plays — one click, as plan S11 has it.
	 */
	async relink(): Promise<void> {
		if (this.#root === null) return;
		this.folder = await requestRootPermission(this.#root);
		if (this.folder === 'granted' && player.current !== null) player.play();
	}

	/**
	 * Path B. Past doc 05 §7's 80 % line the files wait for a second click
	 * (`confirmImport`) — a warning, where the spike refused outright.
	 */
	async importFiles(files: readonly File[], confirmed = false): Promise<void> {
		requestPersistence();
		if (files.length === 0 || this.scanning !== null) return;
		if (!confirmed) {
			const incoming = files.reduce((sum, file) => sum + file.size, 0);
			if (willExceedQuota(await estimateQuota(), incoming)) {
				this.pendingImport = files;
				return;
			}
		}
		this.pendingImport = null;
		const controller = new AbortController();
		this.#controller = controller;
		this.scanning = { done: 0, total: files.length };
		try {
			this.summary = await importIntoLibrary(files, {
				target: this.#target,
				signal: controller.signal,
				onProgress: (progress) => {
					this.scanning = progress;
				}
			});
		} finally {
			this.scanning = null;
			this.#controller = null;
			await this.#refresh().catch(() => undefined);
		}
	}

	confirmImport(): Promise<void> {
		const files = this.pendingImport;
		return files === null ? Promise.resolve() : this.importFiles(files, true);
	}

	dismissImport(): void {
		this.pendingImport = null;
	}

	/** Test seam: a fresh store over `target`. Never called in production. */
	reset(target: TpDb = defaultDb): void {
		this.#controller?.abort();
		this.#target = target;
		this.#root = null;
		this.#loading = null;
		this.#controller = null;
		this.tracks = [];
		this.loaded = false;
		this.failed = false;
		this.folder = 'none';
		this.scanning = null;
		this.summary = null;
		this.scanFailed = false;
		this.pendingImport = null;
		this.orphans = NO_ORPHANS;
	}
}

export const collection = new TpCollection();
