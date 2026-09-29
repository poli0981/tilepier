#!/usr/bin/env node
/**
 * Regenerates the media widget's video fixtures (doc 19 §3, Week 7b).
 *
 * Every clip is ffmpeg's own test pattern over a sine tone, synthesised on the
 * spot, so nothing in the fixture folder is anyone's film. The output is
 * committed; this runs again only when a fixture has to change, and not in CI
 * (the runners are not promised an ffmpeg with these encoders).
 *
 *   pnpm fixtures:media     # needs ffmpeg with libvpx-vp9, libopus and libx264
 *
 * It writes only the files it names — the music script's clean-out also took
 * the hand-written README with it (Week 7b plan §3.9), and this one must not.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', 'src', 'lib', 'widgets', 'media', '__fixtures__');

/** Long enough that "resume after 5 s, unless within 5 s of the end" has room. */
const SECONDS = 14;

/** Reproducible output: no encoder banner, no creation time, one thread. */
const EXACT = [
	'-fflags',
	'+bitexact',
	'-flags:a',
	'+bitexact',
	'-flags:v',
	'+bitexact',
	'-threads',
	'1'
];

const PICTURE = ['-f', 'lavfi', '-i', `testsrc2=size=160x90:rate=10:duration=${SECONDS}`];
const TONE = (seconds) => [
	'-f',
	'lavfi',
	'-i',
	`sine=frequency=440:duration=${seconds}:sample_rate=48000`
];

function ffmpeg(args, name) {
	const result = spawnSync(
		'ffmpeg',
		['-hide_banner', '-loglevel', 'error', '-y', ...args, join(OUT, name)],
		{
			stdio: 'inherit'
		}
	);
	if (result.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
}

mkdirSync(OUT, { recursive: true });

// VP9 + Opus in WebM: what every browser that has PiP also decodes.
ffmpeg(
	[
		...PICTURE,
		...TONE(SECONDS),
		'-c:v',
		'libvpx-vp9',
		'-b:v',
		'0',
		'-crf',
		'55',
		'-deadline',
		'good',
		'-cpu-used',
		'5',
		'-c:a',
		'libopus',
		'-b:a',
		'16k',
		'-ac',
		'1',
		...EXACT
	],
	'clip.webm'
);

// H.264 + AAC in MP4, moov first: the "open any video" case.
ffmpeg(
	[
		...PICTURE,
		...TONE(SECONDS),
		'-c:v',
		'libx264',
		'-profile:v',
		'baseline',
		'-crf',
		'42',
		'-pix_fmt',
		'yuv420p',
		'-c:a',
		'aac',
		'-b:a',
		'24k',
		'-ac',
		'1',
		'-movflags',
		'+faststart',
		...EXACT
	],
	'clip.mp4'
);

// Sound and no picture: the "no picture this browser can show" state.
ffmpeg([...TONE(3), '-c:a', 'libopus', '-b:a', '16k', '-ac', '1', ...EXACT], 'sound-only.webm');

// Named like a video, is not one: the codec state, in every browser alike.
writeFileSync(join(OUT, 'not-video.mp4'), 'This file is named like a video and is not a video.\n');

console.log(`media fixtures written to ${OUT}`);
