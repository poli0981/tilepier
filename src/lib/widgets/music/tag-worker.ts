/// <reference lib="webworker" />
import { parseBlob } from 'music-metadata';

/**
 * Tag parsing, off the main thread — doc 09 §2 makes the Web Worker mandatory,
 * not an optimisation. Parsing 200 files on the main thread freezes the deck
 * for seconds, and the music widget is supposed to be usable while a library
 * scans.
 *
 * `parseBlob` reads through ranged Blob slices rather than loading whole
 * files, which is what keeps memory flat on a large library (doc 22 §S2
 * "Watch"). Handing it an ArrayBuffer instead would defeat that.
 */

export interface TagRequest {
	id: string;
	file: File;
}

export interface TagResult {
	id: string;
	title: string;
	artist: string;
	album: string;
	durationMs?: number;
	trackNo?: number;
	year?: number;
	/** SHA-256 of the cover bytes, so identical artwork is stored once. */
	coverHash?: string;
	cover?: Blob;
	error?: string;
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const view = new Uint8Array(bytes);
	const digest = await crypto.subtle.digest('SHA-256', view.buffer as ArrayBuffer);
	return [...new Uint8Array(digest)]
		.slice(0, 12)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function parseOne({ id, file }: TagRequest): Promise<TagResult> {
	try {
		const { common, format } = await parseBlob(file, { duration: true });

		const picture = common.picture?.[0];
		const result: TagResult = {
			id,
			// A file with no tags still has to appear in the library — falling
			// back to the filename is what makes an untagged folder usable.
			title: common.title?.trim() || file.name.replace(/\.[^.]+$/, ''),
			artist: common.artist?.trim() || 'không rõ',
			album: common.album?.trim() || 'không rõ'
		};

		if (format.duration != null) result.durationMs = Math.round(format.duration * 1000);
		if (common.track?.no != null) result.trackNo = common.track.no;
		if (common.year != null) result.year = common.year;

		if (picture) {
			const bytes = new Uint8Array(picture.data);
			result.coverHash = await sha256(bytes);
			result.cover = new Blob([bytes], { type: picture.format });
		}

		return result;
	} catch (error) {
		// A single unreadable file must not abort a 200-file scan.
		return {
			id,
			title: file.name.replace(/\.[^.]+$/, ''),
			artist: 'không rõ',
			album: 'không rõ',
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

self.addEventListener('message', (event: MessageEvent<TagRequest[]>) => {
	const batch = event.data;
	void (async () => {
		for (const request of batch) {
			const result = await parseOne(request);
			// Posted one at a time so the UI can render progressively rather than
			// sitting blank until the whole batch finishes.
			self.postMessage(result);
		}
		self.postMessage({ done: true });
	})();
});

export {};
