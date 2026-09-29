import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchCsp } from './_lib/csp';
import { acceptGate } from './_lib/gate';
import { fillOpfs, lapseGrant, LIBRARY_SONGS, stubPicker } from './_lib/music';
import { seedLayout } from './_lib/seed';

/**
 * The music widget end to end (doc 09 §2), on the built app under its real CSP
 * (doc 15 §2) — path A through the OPFS-backed picker of `_lib/music`, path B
 * through the detail's file input.
 *
 * **The audio really plays.** Playwright's browser is Chrome for Testing,
 * which has the codecs (doc 22 §S7), and a headless run is muted, not
 * stopped. What the OS would show is read where the OS reads it:
 * `navigator.mediaSession`. The fixture songs last a second each, so rather
 * than race them, an init script records every title and playback state the
 * page writes there, and the tests read that history.
 */

const MUSIC_TILE = [
	{ instanceId: 'wgt_music', widgetId: 'music', x: 0, y: 0, w: 4, h: 2, settings: {} }
];

interface TpSessionLog {
	titles: (string | null)[];
	states: string[];
	/** What the session holds now. */
	state: string;
	title: string | null;
}

/** Records what the page writes to its Media Session, from before its first script. */
async function recordSession(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const log = { titles: [] as (string | null)[], states: [] as string[] };
		(window as unknown as { __tpSession: typeof log }).__tpSession = log;
		const proto = MediaSession.prototype;
		for (const [name, into] of [
			[
				'metadata',
				(value: unknown) => log.titles.push((value as MediaMetadata | null)?.title ?? null)
			],
			['playbackState', (value: unknown) => log.states.push(String(value))]
		] as const) {
			const real = Object.getOwnPropertyDescriptor(proto, name);
			Object.defineProperty(proto, name, {
				configurable: true,
				get(this: MediaSession) {
					return real?.get?.call(this);
				},
				set(this: MediaSession, value: unknown) {
					into(value);
					real?.set?.call(this, value);
				}
			});
		}
	});
}

async function sessionLog(page: Page): Promise<TpSessionLog> {
	return page.evaluate(() => {
		const log = (window as unknown as { __tpSession: Omit<TpSessionLog, 'state' | 'title'> })
			.__tpSession;
		return {
			titles: [...log.titles],
			states: [...log.states],
			state: navigator.mediaSession.playbackState,
			title: navigator.mediaSession.metadata?.title ?? null
		};
	});
}

async function clearSessionLog(page: Page): Promise<void> {
	await page.evaluate(() => {
		const log = (window as unknown as { __tpSession: Omit<TpSessionLog, 'state' | 'title'> })
			.__tpSession;
		log.titles.length = 0;
		log.states.length = 0;
	});
}

/** A deck with the music tile on it, and the fixture library picked from it. */
async function pickFolder(page: Page): Promise<void> {
	await stubPicker(page);
	await recordSession(page);
	await seedLayout(page, MUSIC_TILE);
	await acceptGate(page, { dismissCoach: true });
	await fillOpfs(page);

	await page.getByTestId('music-empty').getByTestId('music-pick').click();
	await expect(page.getByTestId('music-tile')).toBeVisible({ timeout: 15_000 });
}

test('a folder picked from the tile plays, and the OS’s media keys see it', async ({ page }) => {
	const violations = await watchCsp(page);
	await pickFolder(page);

	await page.getByTestId('music-toggle').click();

	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	// The tags' titles, in library order — not the file names.
	await expect.poll(async () => (await sessionLog(page)).titles[0]).toBe('Một');
	expect(await violations()).toEqual([]);
});

test('resetting the deck from Settings, where no deck is mounted, stops the music', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await pickFolder(page);
	await page.getByTestId('music-toggle').click();
	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');

	// A link, not a goto: a page load would silence the audio by itself, and
	// the point is that the player notices the deck without a page to tell it.
	await page.getByRole('link', { name: 'Cài đặt' }).click();
	await page.getByTestId('reset-deck').click();

	// Cleared, not merely paused: no media key may start it again.
	await expect.poll(async () => (await sessionLog(page)).state).toBe('none');
	expect((await sessionLog(page)).title).toBeNull();
	expect(await violations()).toEqual([]);
});

test('after a lapsed grant the tile asks once, and that one click resumes the song', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await pickFolder(page);
	await page.getByTestId('music-toggle').click();
	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	await page.getByTestId('music-toggle').click();
	await expect.poll(async () => (await sessionLog(page)).state).toBe('paused');
	const song = (await sessionLog(page)).title;
	expect(await violations()).toEqual([]);

	// A browser restart without "Allow on every visit".
	await lapseGrant(page);
	await page.reload();

	const card = page.getByTestId('music-permission');
	await expect(card).toContainText(`Tiếp tục: ${song ?? ''}`);
	await clearSessionLog(page);
	await card.getByTestId('music-relink').click();

	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	expect((await sessionLog(page)).titles[0]).toBe(song);
	await expect(page.getByTestId('music-tile')).toBeVisible();
	expect(await violations()).toEqual([]);
});

test('songs added in the detail are listed, found without their accents, and play', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await recordSession(page);
	await seedLayout(page, MUSIC_TILE);
	await acceptGate(page, { dismissCoach: true });

	await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
	const detail = page.getByTestId('music-detail');
	await detail.getByTestId('music-add-files').setInputFiles(LIBRARY_SONGS);
	const rows = detail.getByTestId('music-list').locator('.tp-mrow');
	await expect(rows).toHaveCount(3, { timeout: 15_000 });

	await detail.getByTestId('music-search').fill('mot');
	await expect(rows).toHaveCount(1);
	await rows.first().click();

	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	expect((await sessionLog(page)).titles[0]).toBe('Một');
	expect(await violations()).toEqual([]);
});

/**
 * Spike S2's pass criterion, kept when its harness went (Week 7b-1): 200 files
 * import in under ten seconds and the page keeps drawing throughout — doc 22
 * §S2, measured at 806–863 ms in S7. The files are real WAVs, so the tag
 * parser does real work; a frame counter that stops would mean a parse ran on
 * the main thread.
 */
test.describe('a large import (doc 22 §S2)', () => {
	const COUNT = 200;
	let folder: string;
	let paths: string[];

	/** A minimal but valid 8-bit mono WAV, whose header music-metadata reads. */
	function wav(seconds: number, sampleRate = 8000): Buffer {
		const samples = Math.floor(seconds * sampleRate);
		const data = Buffer.alloc(samples);
		for (let i = 0; i < samples; i++) {
			// A quiet sine, so the file is not one repeated byte.
			data[i] = 128 + Math.round(40 * Math.sin((i / sampleRate) * 2 * Math.PI * 220));
		}
		const header = Buffer.alloc(44);
		header.write('RIFF', 0);
		header.writeUInt32LE(36 + data.length, 4);
		header.write('WAVE', 8);
		header.write('fmt ', 12);
		header.writeUInt32LE(16, 16);
		header.writeUInt16LE(1, 20);
		header.writeUInt16LE(1, 22);
		header.writeUInt32LE(sampleRate, 24);
		header.writeUInt32LE(sampleRate, 28);
		header.writeUInt16LE(1, 32);
		header.writeUInt16LE(8, 34);
		header.write('data', 36);
		header.writeUInt32LE(data.length, 40);
		return Buffer.concat([header, data]);
	}

	test.beforeAll(() => {
		folder = mkdtempSync(join(tmpdir(), 'tp-music-200-'));
		paths = Array.from({ length: COUNT }, (_, i) => {
			const path = join(folder, `track-${String(i).padStart(3, '0')}.wav`);
			writeFileSync(path, wav(0.25 + (i % 8) * 0.05));
			return path;
		});
	});

	test.afterAll(() => {
		rmSync(folder, { recursive: true, force: true });
	});

	test(`imports ${String(COUNT)} files in under 10 s, and the page keeps drawing`, async ({
		page
	}) => {
		const violations = await watchCsp(page);
		await seedLayout(page, MUSIC_TILE);
		await acceptGate(page, { dismissCoach: true });
		await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
		const detail = page.getByTestId('music-detail');
		await page.evaluate(() => {
			const counter = window as unknown as { __tpFrames: number };
			counter.__tpFrames = 0;
			const tick = () => {
				counter.__tpFrames += 1;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});

		const started = Date.now();
		await detail.getByTestId('music-add-files').setInputFiles(paths);
		await expect(detail.getByText(`${String(COUNT)} bài`, { exact: true })).toBeVisible({
			timeout: 60_000
		});
		const elapsed = Date.now() - started;

		expect(elapsed, `the import took ${String(elapsed)} ms`).toBeLessThan(10_000);
		const frames = await page.evaluate(
			() => (window as unknown as { __tpFrames: number }).__tpFrames
		);
		expect(frames, 'the page stopped drawing during the import').toBeGreaterThan(10);
		expect(await violations()).toEqual([]);
	});
});
