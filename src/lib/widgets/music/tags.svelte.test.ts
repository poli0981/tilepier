import type { IPicture } from 'music-metadata';
import { describe, expect, it } from 'vitest';
import { COVER_MAX_BYTES, coverOf, parseTags, text } from './tags';
import flacUrl from './__fixtures__/formats/tagged.flac?url';
import m4aUrl from './__fixtures__/formats/tagged.m4a?url';
import mp3Url from './__fixtures__/formats/tagged.mp3?url';
import notAudioUrl from './__fixtures__/formats/not-audio.mp3?url';
import oggUrl from './__fixtures__/formats/tagged.ogg?url';
import opusUrl from './__fixtures__/formats/tagged.opus?url';
import twoCoversUrl from './__fixtures__/formats/two-covers.mp3?url';
import untaggedUrl from './__fixtures__/formats/untagged.mp3?url';
import vbrUrl from './__fixtures__/formats/vbr-no-header.mp3?url';
import wavUrl from './__fixtures__/formats/tagged.wav?url';

/**
 * doc 09 §2's six containers, through the real parser, in the browser project
 * so music-metadata resolves its browser build — the one the worker ships.
 * The fixtures are sine tones `scripts/gen-music-fixtures.mjs` tags with
 * Vietnamese on purpose; doc 22 §S7 has the measurements behind each case.
 */

async function fixture(url: string, name: string): Promise<File> {
	const response = await fetch(url);
	return new File([await response.blob()], name);
}

const TAGGED = [
	['mp3', mp3Url, true],
	['m4a', m4aUrl, true],
	['flac', flacUrl, true],
	['ogg', oggUrl, false],
	['opus', opusUrl, false],
	['wav', wavUrl, false]
] as const;

describe('parseTags', () => {
	for (const [extension, url, hasCover] of TAGGED) {
		it(`reads a tagged .${extension}`, async () => {
			const tags = await parseTags(await fixture(url, `tagged.${extension}`));

			expect(tags).toMatchObject({
				title: 'Bài hát thử',
				artist: 'Nghệ sĩ',
				album: 'Album thử',
				trackNo: 3,
				year: 2021
			});
			// A one-second tone; AAC and MP3 frames pad it slightly.
			expect(tags.durationMs).toBeGreaterThanOrEqual(1000);
			expect(tags.durationMs).toBeLessThan(1100);

			if (hasCover) {
				expect(tags.cover?.blob.type).toBe('image/png');
				expect(tags.cover?.hash).toMatch(/^[0-9a-f]{24}$/);
			} else {
				expect(tags.cover).toBeUndefined();
			}
		});
	}

	it('takes the front cover when the back one comes first', async () => {
		// music-metadata's own selectCover() would hand back the back of the
		// sleeve here. Both covers are 16×16 PNGs of different colours; the front
		// one is byte-identical to tagged.mp3's.
		const front = await parseTags(await fixture(mp3Url, 'tagged.mp3'));
		const chosen = await parseTags(await fixture(twoCoversUrl, 'two-covers.mp3'));

		expect(chosen.cover?.hash).toBe(front.cover?.hash);
	});

	it('names an untagged file after itself, and invents nothing else', async () => {
		const tags = await parseTags(await fixture(untaggedUrl, 'untagged.mp3'));

		expect(tags).toMatchObject({ title: 'untagged', artist: '', album: '' });
		expect(tags.trackNo).toBeUndefined();
		expect(tags.year).toBeUndefined();
	});

	it('leaves the duration of a headerless VBR file to the player', async () => {
		// With `duration: true` this file is read to its end to count frames.
		const tags = await parseTags(await fixture(vbrUrl, 'vbr-no-header.mp3'));

		expect(tags.title).toBe('Không có header');
		expect(tags.durationMs).toBeUndefined();
	});

	it('refuses a file named like audio that is not', async () => {
		await expect(parseTags(await fixture(notAudioUrl, 'not-audio.mp3'))).rejects.toMatchObject({
			name: 'CouldNotDetermineFileTypeError'
		});
	});
});

describe('text', () => {
	it('reads UTF-8 that arrived decoded as Latin-1 (a WAV file’s RIFF INFO)', () => {
		const mangled = String.fromCharCode(...new TextEncoder().encode('Bài hát thử'));
		expect(mangled).not.toBe('Bài hát thử');

		expect(text(mangled)).toBe('Bài hát thử');
	});

	it('leaves genuine Latin-1 alone', () => {
		// The é here is one byte above ASCII with no continuation — not UTF-8.
		expect(text('Café')).toBe('Café');
	});

	it('trims, composes, and treats absent as empty', () => {
		expect(text('  Sơn Tùng  ')).toBe('Sơn Tùng');
		expect(text('Sơn Tùng'.normalize('NFD'))).toBe('Sơn Tùng'.normalize('NFC'));
		expect(text(undefined)).toBe('');
	});
});

describe('coverOf', () => {
	function picture(bytes: number, type?: string): IPicture {
		return {
			format: 'image/png',
			data: new Uint8Array(bytes),
			...(type === undefined ? {} : { type })
		};
	}

	it('prefers the front cover, then the first picture', () => {
		const back = picture(10, 'Cover (back)');
		const front = picture(20, 'Cover (front)');
		expect(coverOf([back, front])).toBe(front);
		// An MP4 `covr` atom carries no type at all.
		const untyped = picture(30);
		expect(coverOf([untyped, picture(40)])).toBe(untyped);
	});

	it('drops a cover too big to keep, and has none to give when there is none', () => {
		expect(coverOf([picture(COVER_MAX_BYTES + 1, 'Cover (front)')])).toBeUndefined();
		expect(coverOf([picture(COVER_MAX_BYTES, 'Cover (front)')])).toBeDefined();
		expect(coverOf([])).toBeUndefined();
		expect(coverOf(undefined)).toBeUndefined();
	});
});
