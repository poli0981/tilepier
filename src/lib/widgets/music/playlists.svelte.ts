import { db as defaultDb, type TpDb, type TpPlaylist } from '$lib/core/storage/db';
import { moved, PLAYLIST_NAME_MAX, readPlaylist } from './service';

/**
 * The reader's playlists (doc 09 §2), over Dexie's `playlists` table, which
 * has existed since version 1 (doc 05 §3) and is in backups (§6).
 *
 * **Written through, one row per action, not debounced.** doc 04 §6 debounces
 * keystroke-level edits by 300 ms, and `core/storage/dexie-writer` does it for
 * one record at a time — the last value in the window wins. That is right for
 * a note being typed and wrong here: renaming one playlist and adding to
 * another within 300 ms would drop the first write. Nothing here is
 * keystroke-level — a rename is kept on Enter or on leaving the field, and
 * everything else is a click — so each action writes its row and is done.
 *
 * **The list first, the row second.** Two presses a few milliseconds apart
 * must both count, so every action changes `list` before it awaits anything
 * and the next one builds on that, not on whatever the last write has
 * finished. IndexedDB runs read-write transactions over the same store in the
 * order they were made, so the stored row ends where the list does.
 *
 * `activeId` is the playlist the library's "+" buttons add to; with none
 * chosen the library shows no "+" at all.
 */
class TpPlaylists {
	list = $state.raw<readonly TpPlaylist[]>([]);
	loaded = $state(false);
	activeId = $state<string | null>(null);

	#target: TpDb = defaultDb;
	#loading: Promise<void> | null = null;

	get active(): TpPlaylist | null {
		return this.list.find((playlist) => playlist.id === this.activeId) ?? null;
	}

	load(): Promise<void> {
		this.#loading ??= this.#target.playlists
			.orderBy('order')
			.toArray()
			.then((rows) => {
				this.list = rows.flatMap((row) => {
					const playlist = readPlaylist(row);
					return playlist === null ? [] : [playlist];
				});
			})
			.catch(() => {
				// Fail closed (doc 05 §5), and nothing about the lists in the log.
				this.list = [];
			})
			.finally(() => {
				this.loaded = true;
			});
		return this.#loading;
	}

	/** A new playlist, chosen at once so "+" adds to it. `null` for a blank name. */
	async create(name: string): Promise<TpPlaylist | null> {
		const clean = name.trim().slice(0, PLAYLIST_NAME_MAX);
		if (clean === '') return null;
		// A list made before the stored ones are read would be dropped by the read.
		await this.load();
		const order = this.list.reduce((max, playlist) => Math.max(max, playlist.order), -1) + 1;
		const playlist: TpPlaylist = { id: crypto.randomUUID(), name: clean, order, trackIds: [] };
		this.list = [...this.list, playlist];
		this.activeId = playlist.id;
		await this.#target.playlists.put(playlist);
		return playlist;
	}

	async rename(id: string, name: string): Promise<void> {
		const clean = name.trim().slice(0, PLAYLIST_NAME_MAX);
		if (clean === '') return;
		await this.#write(id, (playlist) => ({ ...playlist, name: clean }));
	}

	/** Deletes the list — never the songs, which stay in the library. */
	async remove(id: string): Promise<void> {
		this.list = this.list.filter((playlist) => playlist.id !== id);
		if (this.activeId === id) this.activeId = null;
		await this.#target.playlists.delete(id);
	}

	/** Adds a track once: a second press on the same "+" changes nothing. */
	async add(id: string, trackId: string): Promise<void> {
		await this.#write(id, (playlist) =>
			playlist.trackIds.includes(trackId)
				? playlist
				: { ...playlist, trackIds: [...playlist.trackIds, trackId] }
		);
	}

	async move(id: string, index: number, by: -1 | 1): Promise<void> {
		await this.#write(id, (playlist) => ({
			...playlist,
			trackIds: moved(playlist.trackIds, index, by)
		}));
	}

	async removeAt(id: string, index: number): Promise<void> {
		await this.#write(id, (playlist) => ({
			...playlist,
			trackIds: playlist.trackIds.filter((_, at) => at !== index)
		}));
	}

	choose(id: string | null): void {
		this.activeId = id;
	}

	async #write(id: string, change: (playlist: TpPlaylist) => TpPlaylist): Promise<void> {
		const current = this.list.find((playlist) => playlist.id === id);
		if (current === undefined) return;
		const next = change(current);
		if (next === current) return;
		this.list = this.list.map((playlist) => (playlist.id === id ? next : playlist));
		await this.#target.playlists.put(next);
	}

	/** Test seam: a fresh store over `target`. Never called in production. */
	reset(target: TpDb = defaultDb): void {
		this.#target = target;
		this.#loading = null;
		this.list = [];
		this.loaded = false;
		this.activeId = null;
	}
}

export const playlists = new TpPlaylists();
