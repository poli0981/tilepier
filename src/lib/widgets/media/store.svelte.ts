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
 * Nothing about the file is logged, ever — not its name (doc 18, the music
 * precedent).
 */

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
	}
}

export const media = new TpMedia();
