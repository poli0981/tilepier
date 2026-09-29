import { decodeSubtitles, SUBTITLES_MAX_BYTES, toVtt, trackLanguage } from './subtitles';

/**
 * The subtitles a reader adds to a video (doc 09 §3): one `<track>` at a time,
 * made from their file as WebVTT (`subtitles.ts`) and served to the element as
 * a `blob:` URL, which `media-src` already allows (doc 15 §2).
 *
 * The browser draws the cues, so the reader's own caption settings — size,
 * colour, background, set in the OS — apply: nothing here styles `::cue`. Cue
 * text is the browser's WebVTT, never HTML on the page (doc 15 §4).
 *
 * Owned by `TpVideoController`, which disposes it with the player: the track
 * goes and its URL is released.
 */
export class TpSubtitles {
	/** The file the subtitles came from; `null` while there are none. */
	name = $state<string | null>(null);
	showing = $state(false);
	/** A file the reader chose that held nothing this could show. */
	failed = $state<string | null>(null);

	readonly #video: HTMLVideoElement;
	#track: HTMLTrackElement | null = null;
	#url: string | null = null;
	#disposed = false;

	constructor(video: HTMLVideoElement) {
		this.#video = video;
	}

	/** Shows the subtitles in `file`, in place of any shown before. */
	async add(file: File): Promise<void> {
		const vtt =
			file.size > SUBTITLES_MAX_BYTES
				? null
				: toVtt(decodeSubtitles(new Uint8Array(await file.arrayBuffer())));
		if (this.#disposed) return;
		if (vtt === null) {
			this.failed = file.name;
			return;
		}
		this.#drop();
		const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
		const track = document.createElement('track');
		track.kind = 'subtitles';
		track.label = file.name;
		track.srclang = trackLanguage(file.name);
		track.src = url;
		// A WebVTT file that parses to nothing, or not at all.
		track.addEventListener('error', () => this.#refuse(track, file.name));
		track.addEventListener('load', () => {
			if ((track.track.cues?.length ?? 0) === 0) this.#refuse(track, file.name);
		});
		// appendChild, not append: the Worker types merge HTMLRewriter's append into Element.
		this.#video.appendChild(track);
		track.track.mode = 'showing';
		this.#track = track;
		this.#url = url;
		this.name = file.name;
		this.failed = null;
		this.showing = true;
	}

	/** Shows or hides them — the C key and the captions button. */
	toggle(): void {
		const track = this.#track?.track;
		if (track === undefined) return;
		track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
		this.showing = track.mode === 'showing';
	}

	dispose(): void {
		this.#disposed = true;
		this.#drop();
	}

	#refuse(track: HTMLTrackElement, name: string): void {
		if (this.#track !== track) return;
		this.#drop();
		this.failed = name;
	}

	#drop(): void {
		this.#track?.remove();
		if (this.#url !== null) URL.revokeObjectURL(this.#url);
		this.#track = null;
		this.#url = null;
		this.name = null;
		this.showing = false;
	}
}
