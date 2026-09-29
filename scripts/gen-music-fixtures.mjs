#!/usr/bin/env node
/**
 * Regenerates the music widget's audio fixtures (doc 19 §3, doc 22 §S7).
 *
 * Every file is a sine tone ffmpeg synthesises on the spot, tagged with
 * metadata written here, so nothing in the fixture folder is anyone's
 * recording or artwork — which is the whole reason they are generated rather
 * than collected. The output is committed; this script only needs to run again
 * when a fixture has to change. It is not part of CI (the runners are not
 * promised an ffmpeg build with these encoders).
 *
 *   pnpm fixtures:music        # needs ffmpeg with libmp3lame, libvorbis, libopus
 *
 * The tags carry Vietnamese on purpose: a parser or a pipeline that mangles
 * "Bài hát thử" on the way to a text node is the bug these files exist to find.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'src', 'lib', 'widgets', 'music', '__fixtures__');
const FORMATS = join(OUT, 'formats');
const LIBRARY = join(OUT, 'library');
const scratch = mkdtempSync(join(tmpdir(), 'tp-music-fixtures-'));

/** Reproducible output: no encoder banner, no creation time. */
const EXACT = ['-fflags', '+bitexact', '-flags:a', '+bitexact', '-flags:v', '+bitexact'];

function ffmpeg(args) {
	const run = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
		stdio: 'inherit'
	});
	if (run.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`);
}

function tone(seconds, frequency = 440) {
	return ['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}:sample_rate=44100`];
}

function metadata(tags) {
	return Object.entries(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);
}

const SONG = {
	title: 'Bài hát thử',
	artist: 'Nghệ sĩ',
	album: 'Album thử',
	track: '3',
	date: '2021'
};

// Two 16×16 covers of different colours, so a test can tell which one it got.
const FRONT = join(scratch, 'front.png');
const BACK = join(scratch, 'back.png');
ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x3366ff:s=16x16', '-frames:v', '1', ...EXACT, FRONT]);
ffmpeg(['-f', 'lavfi', '-i', 'color=c=0xff6633:s=16x16', '-frames:v', '1', ...EXACT, BACK]);

function withCover(cover, kind = 'Cover (front)') {
	return [
		'-i',
		cover,
		'-map',
		'0:a',
		'-map',
		'1:v',
		'-c:v',
		'png',
		'-disposition:v',
		'attached_pic',
		'-metadata:s:v',
		`comment=${kind}`
	];
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(FORMATS, { recursive: true });

// ── one file per container doc 09 §2 accepts ─────────────────────────────
ffmpeg([
	...tone(1),
	...withCover(FRONT),
	'-c:a',
	'libmp3lame',
	'-b:a',
	'64k',
	'-ac',
	'1',
	'-id3v2_version',
	'4',
	...metadata(SONG),
	...EXACT,
	join(FORMATS, 'tagged.mp3')
]);
ffmpeg([
	...tone(1),
	...withCover(FRONT),
	'-c:a',
	'aac',
	'-b:a',
	'48k',
	'-ac',
	'1',
	...metadata(SONG),
	...EXACT,
	join(FORMATS, 'tagged.m4a')
]);
ffmpeg([
	...tone(1),
	...withCover(FRONT),
	'-c:a',
	'flac',
	'-ac',
	'1',
	'-ar',
	'22050',
	...metadata(SONG),
	...EXACT,
	join(FORMATS, 'tagged.flac')
]);
ffmpeg([
	...tone(1),
	'-c:a',
	'libvorbis',
	'-q:a',
	'1',
	'-ac',
	'1',
	...metadata(SONG),
	...EXACT,
	join(FORMATS, 'tagged.ogg')
]);
ffmpeg([
	...tone(1),
	'-c:a',
	'libopus',
	'-b:a',
	'24k',
	'-ac',
	'1',
	...metadata(SONG),
	...EXACT,
	join(FORMATS, 'tagged.opus')
]);
ffmpeg([
	...tone(1),
	'-c:a',
	'pcm_s16le',
	'-ac',
	'1',
	'-ar',
	'8000',
	...metadata(SONG),
	...EXACT,
	join(FORMATS, 'tagged.wav')
]);

// ── the edge cases ───────────────────────────────────────────────────────
// No tags at all: the title has to fall back to the file name.
ffmpeg([
	...tone(1),
	'-c:a',
	'libmp3lame',
	'-b:a',
	'64k',
	'-ac',
	'1',
	'-map_metadata',
	'-1',
	'-write_id3v2',
	'0',
	...EXACT,
	join(FORMATS, 'untagged.mp3')
]);
// VBR with no Xing/Info/LAME header: `duration: false` cannot know its length
// (doc 22 §S7), so the player has to learn it from `loadedmetadata`.
ffmpeg([
	...tone(2),
	'-c:a',
	'libmp3lame',
	'-q:a',
	'4',
	'-ac',
	'1',
	'-write_xing',
	'0',
	...metadata({ title: 'Không có header' }),
	...EXACT,
	join(FORMATS, 'vbr-no-header.mp3')
]);
// The back cover first and the front second: music-metadata's own
// `selectCover()` returns the first picture, so a player that trusts it shows
// the back of the sleeve.
ffmpeg([
	...tone(1),
	'-i',
	BACK,
	'-i',
	FRONT,
	'-map',
	'0:a',
	'-map',
	'1:v',
	'-map',
	'2:v',
	'-c:v',
	'png',
	'-disposition:v:0',
	'attached_pic',
	'-disposition:v:1',
	'attached_pic',
	'-metadata:s:v:0',
	'comment=Cover (back)',
	'-metadata:s:v:1',
	'comment=Cover (front)',
	'-c:a',
	'libmp3lame',
	'-b:a',
	'64k',
	'-ac',
	'1',
	'-id3v2_version',
	'3',
	...metadata({ title: 'Hai bìa' }),
	...EXACT,
	join(FORMATS, 'two-covers.mp3')
]);
// Named like audio, is not audio.
writeFileSync(join(FORMATS, 'not-audio.mp3'), 'This file is named like audio and is not audio.\n');

// ── a small library for scans: nested folders and the files a scan skips ──
const albumDir = join(LIBRARY, 'Artist A', 'Album 1');
mkdirSync(albumDir, { recursive: true });
mkdirSync(join(LIBRARY, 'Artist B'), { recursive: true });
mkdirSync(join(LIBRARY, '.hidden'), { recursive: true });
ffmpeg([
	...tone(1, 330),
	'-c:a',
	'libmp3lame',
	'-b:a',
	'64k',
	'-ac',
	'1',
	'-id3v2_version',
	'4',
	...metadata({ title: 'Một', artist: 'Artist A', album: 'Album 1', track: '1' }),
	...EXACT,
	join(albumDir, '01 One.mp3')
]);
ffmpeg([
	...tone(1, 392),
	'-c:a',
	'flac',
	'-ac',
	'1',
	'-ar',
	'22050',
	...metadata({ title: 'Hai', artist: 'Artist A', album: 'Album 1', track: '2' }),
	...EXACT,
	join(albumDir, '02 Two.flac')
]);
ffmpeg([
	...tone(1, 523),
	'-c:a',
	'libvorbis',
	'-q:a',
	'1',
	'-ac',
	'1',
	...metadata({ title: 'Ba', artist: 'Artist B' }),
	...EXACT,
	join(LIBRARY, 'Artist B', 'Three.ogg')
]);
// What a scan must pass over: an image, macOS's AppleDouble shadow of a
// track, and a hidden folder.
ffmpeg([
	'-f',
	'lavfi',
	'-i',
	'color=c=0x22aa66:s=16x16',
	'-frames:v',
	'1',
	...EXACT,
	join(albumDir, 'cover.png')
]);
writeFileSync(join(albumDir, '._01 One.mp3'), 'AppleDouble metadata, not audio.\n');
ffmpeg([
	...tone(1, 262),
	'-c:a',
	'libmp3lame',
	'-b:a',
	'64k',
	'-ac',
	'1',
	...EXACT,
	join(LIBRARY, '.hidden', 'Skipped.mp3')
]);

rmSync(scratch, { recursive: true, force: true });
console.log(`music fixtures written to ${OUT}`);
