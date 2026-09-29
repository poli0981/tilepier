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
 * With nothing open — a new page — the tile shows the last video worth coming
 * back to, read from `playback` (`resume.ts`): the file has to be picked
 * again, and the player finds its place by its name and size.
 *
 * Nothing about the file is logged, ever — not its name (doc 18, the music
 * precedent).
 */

import { latestResume } from './resume';
import type { TpResume } from './service';

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

class TpMedia {
	current = $state.raw<TpMediaFile | null>(null);
	positionMs = $state(0);
	durationMs = $state(0);
	playing = $state(false);
	/** The last video worth coming back to, for a page with none open. */
	last = $state.raw<TpResume | null>(null);
	lastStatus = $state<'loading' | 'ready' | 'error'>('loading');
	#reading: Promise<void> | null = null;
	/** Which read may still write: a retry or a reset starts a new one. */
	#token = 0;

	/** Reads `last`, once per page (the tile asks); `retryLast` reads again. */
	loadLast(): Promise<void> {
		this.#reading ??= this.#readLast();
		return this.#reading;
	}

	retryLast(): Promise<void> {
		this.#token += 1;
		this.#reading = null;
		this.lastStatus = 'loading';
		return this.loadLast();
	}

	async #readLast(): Promise<void> {
		const token = this.#token;
		try {
			const last = await latestResume();
			if (token !== this.#token) return;
			this.last = last;
			this.lastStatus = 'ready';
		} catch {
			if (token === this.#token) this.lastStatus = 'error';
		}
	}

	/** A video the reader chose: the detail plays it when it mounts. */
	open(file: TpMediaFile): void {
		this.current = file;
		this.positionMs = 0;
		this.durationMs = 0;
		this.playing = false;
	}

	/** What the player says, for the tile. */
	report(positionMs: number, durationMs: number, playing: boolean): void {
		this.positionMs = positionMs;
		this.durationMs = durationMs;
		this.playing = playing;
	}

	/** Test seam: nothing open. Never called in production. */
	reset(): void {
		this.current = null;
		this.positionMs = 0;
		this.durationMs = 0;
		this.playing = false;
		this.last = null;
		this.lastStatus = 'loading';
		this.#reading = null;
		this.#token += 1;
	}
}

export const media = new TpMedia();
