/**
 * The video the reader opened, as the tile and the detail both see it (doc 09
 * §3).
 *
 * The `<video>` lives in the detail, because picture-in-picture ends when the
 * detail closes (owner decision Q2), so no element is kept here. What is kept is
 * which file is open and what the player last said about it, for the tile. A
 * module store for the reason music has one: there is no `liveQuery`, and two
 * components read the same thing.
 *
 * **With nothing open** — a new page — the tile and the detail show the shelf
 * (`recents.ts`): the last video worth coming back to, and the videos opened
 * through the picker, each with where it was left and its still. One opened
 * through the picker opens again from its handle; any other is picked again,
 * and the player finds its place by its name and size.
 *
 * The stills are `blob:` URLs made here and released here: on the next read of
 * the shelf, and when the open video's still is replaced.
 *
 * Nothing about the file is logged, ever — not its name (doc 18, the music
 * precedent).
 */

import { readShelf, type TpShelfRow } from './recents';

export interface TpMediaFile {
	name: string;
	size: number;
	file: File;
	/**
	 * Set for a file opened through the File System Access picker. The player
	 * reads the file again from it on every mount, so a file edited since it was
	 * opened plays as it is now rather than failing as a stale snapshot.
	 */
	handle?: FileSystemFileHandle | undefined;
}

/** A shelf row as the tile and the detail draw it: its still as a URL. */
export interface TpShelfItem extends Omit<TpShelfRow, 'poster'> {
	poster: string | null;
}

class TpMedia {
	current = $state.raw<TpMediaFile | null>(null);
	positionMs = $state(0);
	durationMs = $state(0);
	playing = $state(false);
	/** The still of the video open now; the player keeps it current. */
	poster = $state<string | null>(null);
	/** The last video worth coming back to, for a page with none open. */
	last = $state.raw<TpShelfItem | null>(null);
	/** The videos opened through the picker, newest first. */
	recents = $state.raw<TpShelfItem[]>([]);
	shelfStatus = $state<'loading' | 'ready' | 'error'>('loading');
	#reading: Promise<void> | null = null;
	/** Which read may still write: a new read or a reset starts a new one. */
	#token = 0;
	/** The shelf's still URLs, released when the shelf is read again. */
	#shelfUrls: string[] = [];

	/** Reads the shelf, once per page (the tile and the detail ask). */
	loadShelf(): Promise<void> {
		this.#reading ??= this.#readShelf();
		return this.#reading;
	}

	/** Reads it again — a retry, or after something was forgotten. */
	refreshShelf(): Promise<void> {
		this.#token += 1;
		this.#reading = null;
		if (this.shelfStatus === 'error') this.shelfStatus = 'loading';
		return this.loadShelf();
	}

	async #readShelf(): Promise<void> {
		const token = this.#token;
		try {
			const shelf = await readShelf();
			if (token !== this.#token) return;
			const urls: string[] = [];
			const item = (row: TpShelfRow): TpShelfItem => {
				const poster = row.poster === null ? null : URL.createObjectURL(row.poster);
				if (poster !== null) urls.push(poster);
				return { ...row, poster };
			};
			this.last = shelf.last === null ? null : item(shelf.last);
			this.recents = shelf.recents.map(item);
			this.#dropShelfUrls();
			this.#shelfUrls = urls;
			this.shelfStatus = 'ready';
		} catch {
			if (token === this.#token) this.shelfStatus = 'error';
		}
	}

	#dropShelfUrls(): void {
		for (const url of this.#shelfUrls) URL.revokeObjectURL(url);
		this.#shelfUrls = [];
	}

	/** A video the reader chose: the detail plays it when it mounts. */
	open(file: TpMediaFile): void {
		this.current = file;
		this.positionMs = 0;
		this.durationMs = 0;
		this.playing = false;
		this.setPoster(null);
	}

	/** What the player says, for the tile. */
	report(positionMs: number, durationMs: number, playing: boolean): void {
		this.positionMs = positionMs;
		this.durationMs = durationMs;
		this.playing = playing;
	}

	/** The open video's still, from storage when it opens and from each pause. */
	setPoster(blob: Blob | null): void {
		if (this.poster !== null) URL.revokeObjectURL(this.poster);
		this.poster = blob === null ? null : URL.createObjectURL(blob);
	}

	/** Test seam: nothing open. Never called in production. */
	reset(): void {
		this.current = null;
		this.positionMs = 0;
		this.durationMs = 0;
		this.playing = false;
		this.setPoster(null);
		this.last = null;
		this.recents = [];
		this.shelfStatus = 'loading';
		this.#dropShelfUrls();
		this.#reading = null;
		this.#token += 1;
	}
}

export const media = new TpMedia();
