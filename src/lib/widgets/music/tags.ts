import { sha256Hex } from '$lib/core/hash';
import { parseBlob, type IPicture } from 'music-metadata';

/**
 * Tag extraction for one file (doc 09 §2) — and the **only** module allowed to
 * import music-metadata. It runs inside the tag worker; `eslint.config.js`
 * refuses the import anywhere else, and a value import of this module anywhere
 * but `tag-worker.ts`, because one careless import would put ~63 KiB of parser
 * on the main thread and no budget row would notice (doc 20 §7).
 *
 * Tests run it on the main thread against the generated fixtures in
 * `__fixtures__/`, which is the one place that is allowed to.
 */

/**
 * What a scan keeps about one file's tags.
 *
 * A missing value is `''`, never a word: the spike wrote the Vietnamese
 * `'không rõ'` into Dexie as data, which put one language's text into every
 * reader's library whatever their locale. The UI renders "Unknown artist" in
 * the reader's own (CLAUDE.md rule 8). The title alone falls back to the file
 * name — that is data about the file, not a translation.
 */
export interface TpTags {
	title: string;
	artist: string;
	album: string;
	durationMs?: number;
	trackNo?: number;
	year?: number;
	cover?: TpCover;
}

export interface TpCover {
	blob: Blob;
	/** SHA-256 of the image bytes, so an album's two hundred tracks store one cover. */
	hash: string;
}

/** One request to the worker, and its answer (doc 22 §S7). */
export interface TpTagRequest {
	id: string;
	file: File;
}

/**
 * The answer carries a *category* of failure and never music-metadata's own
 * message: the log buffer rides along with a bug report, and nothing about a
 * reader's files belongs in it (doc 18, plan S18).
 *
 * `not-audio` is the one failure a scan acts on — a file named like audio that
 * the parser cannot place at all is not listed. Anything else still is,
 * untagged, because a file with broken tags often plays perfectly well.
 */
export type TpTagReply =
	{ id: string; tags: TpTags } | { id: string; failed: 'not-audio' | 'unreadable' };

/**
 * Covers above this are dropped rather than stored (doc 09 §2). The tile draws
 * one at 48 px and the detail at 240; a megabyte is already generous, and a
 * crafted file can claim far more.
 */
export const COVER_MAX_BYTES = 1024 * 1024;

/**
 * A file named like audio in which the parser found no audio at all.
 *
 * music-metadata only throws for that when it has to sniff the content. A file
 * from a folder carries a MIME type guessed from its extension — every one an
 * FSA handle or OPFS hands out does — and music-metadata trusts it: a text file
 * called `fake.mp3` goes to the MPEG parser and comes back with an *empty*
 * format rather than an error (doc 22 §S7). Sniffing everything instead would
 * refuse the odd real MP3 with junk before its first frame, which the MPEG
 * parser finds and plays; so the file is judged by what came back.
 */
export class TpNotAudioError extends Error {
	override name = 'TpNotAudioError';
}

export async function parseTags(file: File): Promise<TpTags> {
	// `duration: false` (doc 22 §S7): with `true`, music-metadata reads a VBR
	// MP3 that has no Xing/Info/LAME header to the end to count its frames.
	// Every other file measured gives a duration without it; that one is
	// learned from the player's `loadedmetadata` instead.
	const { common, format } = await parseBlob(file, { duration: false });
	if (format.container === undefined && format.codec === undefined) {
		throw new TpNotAudioError('no audio stream');
	}

	const tags: TpTags = {
		title: text(common.title) || file.name.replace(/\.[^.]+$/, '').normalize('NFC'),
		artist: text(common.artist),
		album: text(common.album)
	};

	if (isPositive(format.duration)) tags.durationMs = Math.round(format.duration * 1000);
	if (isPositive(common.track.no)) tags.trackNo = common.track.no;
	if (isPositive(common.year)) tags.year = common.year;

	const picture = coverOf(common.picture);
	if (picture !== undefined) {
		const bytes = new Uint8Array(picture.data);
		tags.cover = {
			blob: new Blob([bytes], { type: picture.format.startsWith('image/') ? picture.format : '' }),
			// A cover's storage key: the first twelve bytes, as the track ids.
			hash: await sha256Hex(bytes, 12)
		};
	}

	return tags;
}

/**
 * The front cover when a file labels one, else the first picture — and none
 * when it is too big to keep.
 *
 * music-metadata has a `selectCover()` for this, and it returns the first
 * picture whatever it is (doc 22 §S7): the `two-covers.mp3` fixture, back
 * cover first, shows the back of the sleeve through it. An MP4 `covr` atom
 * carries no picture type at all, so "the first" is the right fallback there.
 */
export function coverOf(pictures: readonly IPicture[] | undefined): IPicture | undefined {
	if (pictures === undefined || pictures.length === 0) return undefined;
	const picture = pictures.find((entry) => entry.type === 'Cover (front)') ?? pictures[0];
	if (picture === undefined || picture.data.byteLength > COVER_MAX_BYTES) return undefined;
	return picture;
}

/**
 * A tag value, trimmed, NFC-normalised, and read as UTF-8 when it was plainly
 * UTF-8 decoded as Latin-1.
 *
 * That last part is measured, not hypothetical (doc 22 §S7): music-metadata
 * reads a WAV file's RIFF INFO strings as Latin-1, and the tools that write
 * them write UTF-8, so "Bài hát thử" came back as "BÃ i hÃ¡t thá»­". The repair
 * only applies when every code unit fits in a byte, at least one is above
 * ASCII, and those bytes are *valid* UTF-8 — genuine Latin-1 text almost never
 * is ("Café" is not; its `é` is a lone continuation-less byte), so a real
 * Latin-1 title is left alone. NFC because a file tagged on macOS may carry
 * decomposed accents, and search folds a composed query (`i18n/fold.ts`).
 */
export function text(value: string | undefined): string {
	const trimmed = value?.trim() ?? '';
	return asUtf8(trimmed).normalize('NFC');
}

function asUtf8(value: string): string {
	let aboveAscii = false;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code > 0xff) return value;
		if (code > 0x7f) aboveAscii = true;
	}
	if (!aboveAscii) return value;

	try {
		const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0));
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return value;
	}
}

function isPositive(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
