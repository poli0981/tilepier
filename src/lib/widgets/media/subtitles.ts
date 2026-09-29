/**
 * Subtitles a reader brings for a video (doc 09 §3, Week 7 plan 7b-3): their
 * bytes read as text, SubRip turned into WebVTT, and a language read off the
 * file name. Pure, so it tests in the node project byte by byte.
 *
 * **Reading the bytes.** A byte-order mark says what the file is: UTF-8,
 * UTF-16LE or UTF-16BE. Without one, UTF-8 — and a file that is not UTF-8 is
 * read as windows-1258, the Vietnamese Windows code page most older `.srt`
 * files were saved in. 1258 spells a toned vowel as a letter plus a combining
 * mark, so the text is composed to NFC afterwards (doc 14 §6).
 *
 * - A file that is UTF-8 but for a stray byte or two stays UTF-8, with a
 *   replacement character where the byte was: reading all of it as 1258 would
 *   garble every accent to save one.
 * - A windows-1252 file (French, Spanish) that is not UTF-8 reads as 1258 too,
 *   and 1252's Ã, Ì, Ò and Õ come out as other letters. Accepted: there is no
 *   telling the two apart from the bytes. TCVN3, VNI and VISCII are not read.
 *
 * **SubRip to WebVTT.** The two share only `<b>`, `<i>` and `<u>`; those are
 * lifted out before `&`, `<` and `>` are escaped, so they survive and nothing
 * else can be read as markup — a stray `-->` in a line included. SubRip's
 * extras go: `<font>` (its text kept), `{\an8}`-style override blocks, and the
 * `X1:` position after a timing. Hours of one digit and milliseconds of fewer
 * than three are read, and a blank line inside a cue is dropped, since in
 * WebVTT it would end the cue.
 */

/** Larger than any subtitle file; a video picked by mistake stops here. */
export const SUBTITLES_MAX_BYTES = 2 * 1024 * 1024;

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
	return prefix.every((byte, index) => bytes[index] === byte);
}

/** UTF-8 unless it plainly is not — then the Vietnamese Windows code page. */
function withoutMark(bytes: Uint8Array): string {
	const utf8 = new TextDecoder('utf-8').decode(bytes);
	let broken = 0;
	let read = 0;
	for (const char of utf8) {
		if (char === '�') broken += 1;
		else if (char > '\u007F') read += 1;
	}
	if (broken === 0 || read >= broken * 10) return utf8;
	return new TextDecoder('windows-1258').decode(bytes);
}

/** A subtitle file's bytes as text: NFC, and lines ended by `\n` alone. */
export function decodeSubtitles(bytes: Uint8Array): string {
	let text: string;
	if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
		text = new TextDecoder('utf-8').decode(bytes.subarray(3));
	} else if (startsWith(bytes, [0xff, 0xfe])) {
		text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
	} else if (startsWith(bytes, [0xfe, 0xff])) {
		text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
	} else {
		text = withoutMark(bytes);
	}
	return text.normalize('NFC').replace(/\r\n?/g, '\n');
}

const TIME = String.raw`(\d{1,2}):(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?`;
const TIMING = new RegExp(String.raw`^\s*${TIME}\s*-->\s*${TIME}`);
const KEPT = /<\/?[biu]>/gi;

function ms(hours = '0', minutes = '0', seconds = '0', fraction = ''): number {
	return (
		((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 +
		Number(fraction.padEnd(3, '0'))
	);
}

/** WebVTT's `HH:MM:SS.mmm`, carrying a SubRip "00:00:75" over into minutes. */
function stamp(total: number): string {
	const pad = (value: number, width = 2) => String(value).padStart(width, '0');
	const hours = Math.floor(total / 3_600_000);
	const minutes = Math.floor(total / 60_000) % 60;
	const seconds = Math.floor(total / 1000) % 60;
	return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(total % 1000, 3)}`;
}

function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One SubRip line as WebVTT cue text. */
function cueLine(line: string): string {
	const plain = line.replace(/\{\\[^}]*\}/g, '').replace(/<\/?font\b[^>]*>/gi, '');
	let out = '';
	let from = 0;
	for (const tag of plain.matchAll(KEPT)) {
		out += escape(plain.slice(from, tag.index)) + tag[0].toLowerCase();
		from = tag.index + tag[0].length;
	}
	return out + escape(plain.slice(from));
}

interface TpCue {
	start: number;
	end: number;
	lines: string[];
}

/** SubRip as WebVTT, or `null` when there is not one cue in it to show. */
export function srtToVtt(srt: string): string | null {
	const lines = srt.split('\n');
	const cues: TpCue[] = [];
	let cue: TpCue | null = null;
	for (const [index, line] of lines.entries()) {
		const timing = TIMING.exec(line);
		if (timing !== null) {
			const [, h1, m1, s1, f1, h2, m2, s2, f2] = timing;
			cue = { start: ms(h1, m1, s1, f1), end: ms(h2, m2, s2, f2), lines: [] };
			cues.push(cue);
			continue;
		}
		const text = line.trim();
		// Before the first timing, a blank line, or the next cue's number.
		if (cue === null || text === '') continue;
		if (/^\d+$/.test(text) && TIMING.test(lines[index + 1] ?? '')) continue;
		cue.lines.push(cueLine(text));
	}
	const kept = cues.filter((entry) => entry.lines.length > 0 && entry.end > entry.start);
	if (kept.length === 0) return null;
	const body = kept.map(
		(entry) => `${stamp(entry.start)} --> ${stamp(entry.end)}\n${entry.lines.join('\n')}`
	);
	return `WEBVTT\n\n${body.join('\n\n')}\n`;
}

/** The file as WebVTT: as it is when it already is, converted when SubRip. */
export function toVtt(text: string): string | null {
	if (/^WEBVTT(?:[ \t\n]|$)/.test(text)) return text.includes('-->') ? text : null;
	return srtToVtt(text);
}

/** The language a file name ends in — `Phim.vi.srt` is `vi` — or `und`. */
export function trackLanguage(name: string): string {
	const tag = /\.([a-z]{2,3}(?:[-_][a-z\d]{2,8})*)\.(?:srt|vtt)$/i.exec(name)?.[1];
	if (tag === undefined) return 'und';
	try {
		return Intl.getCanonicalLocales(tag.replace(/_/g, '-'))[0] ?? 'und';
	} catch {
		return 'und';
	}
}
