import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { watchCsp } from './_lib/csp';
import { allowGrant, chooseFile, fillOpfs, lapseGrant, refuseGrant, stubPickers } from './_lib/fsa';
import { acceptGate } from './_lib/gate';
import { seedLayout } from './_lib/seed';
import { recordSession, sessionLog } from './_lib/session';

/**
 * The video widget end to end (doc 09 §3), on the built app under its real CSP
 * (doc 15 §2): opened through the OPFS-backed picker of `_lib/fsa` and through
 * the file input Brave and Firefox get, the files it cannot play, the keys,
 * subtitles, a reload in the middle of a video, and the shelf a reload leaves:
 * the videos opened lately, with their stills, and forgetting them.
 *
 * **The video really plays.** Chrome for Testing decodes VP9, Opus, H.264 and
 * AAC (doc 22 §S8), and a headless run is muted, not stopped. What the OS would
 * show is read from `navigator.mediaSession` through `_lib/session`.
 */

const MEDIA_TILE = [
	{ instanceId: 'wgt_media', widgetId: 'media', x: 0, y: 0, w: 4, h: 3, settings: {} }
];

const FIXTURES = join(process.cwd(), 'src', 'lib', 'widgets', 'media', '__fixtures__');

async function currentTime(page: Page): Promise<number> {
	return page.getByTestId('media-video').evaluate((video: HTMLVideoElement) => video.currentTime);
}

/** A deck with the video tile, the fixtures in OPFS, and `name` opened from the tile. */
async function openFromTile(page: Page, name: string): Promise<void> {
	await stubPickers(page);
	await recordSession(page);
	await seedLayout(page, MEDIA_TILE);
	await acceptGate(page, { dismissCoach: true });
	await fillOpfs(page, 'media', FIXTURES, [
		'clip.webm',
		'clip.mp4',
		'sound-only.webm',
		'not-video.mp4',
		'subs.vi.srt'
	]);
	await chooseFile(page, name);

	await page.getByTestId('media-tile-open').click();
	await expect(page.getByTestId('media-detail')).toBeVisible();
}

test('a video picked from the tile plays in the detail, and the OS’s media keys see it', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await openFromTile(page, 'clip.webm');

	await expect(page.getByTestId('media-player')).toHaveAttribute('data-phase', 'ready');
	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	expect((await sessionLog(page)).title).toBe('clip.webm');
	expect(await violations()).toEqual([]);
});

test('where there is no picker — Brave, Firefox — the file input opens it, and an MP4 plays', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await page.addInitScript(() => Reflect.deleteProperty(window, 'showOpenFilePicker'));
	await recordSession(page);
	await seedLayout(page, MEDIA_TILE);
	await acceptGate(page, { dismissCoach: true });

	const chooser = page.waitForEvent('filechooser');
	await page.getByTestId('media-tile-open').click();
	await (await chooser).setFiles(join(FIXTURES, 'clip.mp4'));

	await expect(page.getByTestId('media-player')).toHaveAttribute('data-phase', 'ready');
	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	expect((await sessionLog(page)).title).toBe('clip.mp4');
	expect(await violations()).toEqual([]);
});

test('a file this browser cannot play says so and never takes the sound; sound alone plays, and says so', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await openFromTile(page, 'not-video.mp4');

	await expect(page.getByTestId('media-unsupported')).toBeVisible();
	expect((await sessionLog(page)).states).not.toContain('playing');

	await chooseFile(page, 'sound-only.webm');
	await page.getByTestId('media-open-another').click();

	await expect(page.getByTestId('media-audio-only')).toBeVisible();
	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	await expect(page.getByTestId('media-pip')).toHaveCount(0);
	expect(await violations()).toEqual([]);
});

test('the keys answer in the player at once; Escape closes the detail, but not out of full screen', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await openFromTile(page, 'clip.webm');
	await expect(page.getByTestId('media-player')).toHaveAttribute('data-phase', 'ready');
	// No click into the player first: it took focus when the video loaded.
	await expect(page.getByTestId('media-video')).toBeFocused();

	await page.keyboard.press('k');
	await expect(page.getByTestId('media-toggle')).toHaveAttribute('aria-label', 'Phát');
	const before = await currentTime(page);
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => currentTime(page)).toBeCloseTo(before + 5, 0);
	await page.keyboard.press('m');
	await expect(page.getByTestId('media-mute')).toHaveAttribute('aria-label', 'Bật tiếng');
	await page.keyboard.press(' ');
	await expect(page.getByTestId('media-toggle')).toHaveAttribute('aria-label', 'Tạm dừng');

	await page.keyboard.press('f');
	await expect
		.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid')))
		.toBe('media-player');
	// Real Chrome keeps this key to leave full screen; Playwright hands it to
	// the page. Either way the detail stays.
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('media-detail')).toBeVisible();

	await page.evaluate(async () => {
		if (document.fullscreenElement !== null) await document.exitFullscreen();
	});
	// Past the guard's grace after full screen ends (ui/dialog-keys).
	await page.waitForTimeout(600);
	await page.keyboard.press('Escape');

	await expect(page.getByTestId('media-detail')).toBeHidden();
	expect(await violations()).toEqual([]);
});

test('reloaded mid-play, a video from the input is offered back, and the same file picks up where it was', async ({
	page
}) => {
	// The input's file has no handle to keep (Brave, Firefox): after a reload
	// it is offered back to be picked again, and found by its name and size.
	// One from the picker comes back as a recent — the next two tests.
	const violations = await watchCsp(page);
	await page.addInitScript(() => Reflect.deleteProperty(window, 'showOpenFilePicker'));
	await recordSession(page);
	await seedLayout(page, MEDIA_TILE);
	await acceptGate(page, { dismissCoach: true });
	const chooser = page.waitForEvent('filechooser');
	await page.getByTestId('media-tile-open').click();
	await (await chooser).setFiles(join(FIXTURES, 'clip.webm'));
	await expect(page.getByTestId('media-player')).toHaveAttribute('data-phase', 'ready');
	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	await page.getByTestId('media-video').evaluate((video: HTMLVideoElement) => {
		video.currentTime = 5;
	});
	// Played on past the seek's own save: only the closing page keeps this part.
	await expect.poll(() => currentTime(page)).toBeGreaterThan(7);
	const left = await currentTime(page);
	expect(await violations()).toEqual([]);

	await page.reload();

	// The detail was open, so the reload lands on /w/media with no file in hand.
	const last = page.getByTestId('media-last');
	await expect(last).toContainText('clip.webm');
	await expect(last).toContainText(/0:0[78] \/ 0:14/);
	const again = page.waitForEvent('filechooser');
	await page.getByTestId('media-last-continue').click();
	await (await again).setFiles(join(FIXTURES, 'clip.webm'));

	await expect(page.getByTestId('media-resumed')).toContainText(/Xem tiếp từ 0:0[78]/);
	expect(await currentTime(page)).toBeGreaterThanOrEqual(left);
	expect(await violations()).toEqual([]);
});

test('subtitles the reader adds show over the video, read past their mark and CRLF, and C hides them', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await openFromTile(page, 'clip.webm');
	await expect(page.getByTestId('media-player')).toHaveAttribute('data-phase', 'ready');
	const video = page.getByTestId('media-video');
	const track = (read: (video: HTMLVideoElement) => unknown) => video.evaluate(read);

	await chooseFile(page, 'subs.vi.srt');
	await page.getByTestId('media-captions').click();

	await expect.poll(() => track((v) => v.textTracks[0]?.cues?.length ?? 0)).toBe(3);
	expect(await track((v) => (v.textTracks[0]?.cues?.[0] as VTTCue).text)).toBe(
		'Xin chào — đây là <i>phụ đề</i> thử.'
	);
	expect(await track((v) => v.textTracks[0]?.mode)).toBe('showing');
	await expect(page.getByTestId('media-subs')).toContainText('Phụ đề: subs.vi.srt');

	await page.keyboard.press('c');

	await expect.poll(() => track((v) => v.textTracks[0]?.mode)).toBe('hidden');
	await expect(page.getByTestId('media-captions')).toHaveAttribute('aria-label', 'Hiện phụ đề');
	expect(await violations()).toEqual([]);
});

/** Plays `clip.webm` from 0:06, pauses a moment later, and reloads. */
async function watchThenReload(page: Page): Promise<void> {
	await openFromTile(page, 'clip.webm');
	await expect(page.getByTestId('media-player')).toHaveAttribute('data-phase', 'ready');
	await expect.poll(async () => (await sessionLog(page)).states).toContain('playing');
	await page.getByTestId('media-video').evaluate((video: HTMLVideoElement) => {
		video.currentTime = 6;
	});
	await expect.poll(() => currentTime(page)).toBeGreaterThan(6.2);
	// Paused, not ended: a place to come back to, and a still of it.
	await page.getByTestId('media-toggle').click();
	await expect(page.getByTestId('media-toggle')).toHaveAttribute('aria-label', 'Phát');
	// The still is encoded after the pause; wait for it to be kept.
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					new Promise<number>((resolve) => {
						const open = indexedDB.open('tilepier');
						open.onsuccess = () => {
							const request = open.result
								.transaction('playback')
								.objectStore('playback')
								.getAllKeys();
							request.onsuccess = () => {
								resolve(
									request.result.filter((key) => String(key).startsWith('media:poster:')).length
								);
								open.result.close();
							};
						};
					})
			)
		)
		.toBe(1);
	// A browser restart: the grant goes, and the handle stays.
	await lapseGrant(page);
	await page.reload();
}

test('after a reload the tile shows the still, and Continue opens the video from its handle', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await watchThenReload(page);
	await page.goto('/');

	const tile = page.getByTestId('media-tile');
	await expect(tile).toContainText('clip.webm');
	await expect(tile.getByTestId('media-still')).toBeVisible();
	await tile.getByTestId('media-continue').click();

	// No picker: the handle, and the browser asked again (allowed, here).
	await expect(page.getByTestId('media-resumed')).toContainText(/Xem tiếp từ 0:0[67]/);
	expect(await violations()).toEqual([]);
});

test('a recent the browser refuses, or whose file is gone, says so beside it, and Forget takes it', async ({
	page
}) => {
	const violations = await watchCsp(page);
	await watchThenReload(page);
	const recent = page.getByTestId('media-recent');
	await expect(recent).toHaveCount(1);
	await expect(recent.locator('img')).toBeVisible();

	await refuseGrant(page);
	await page.getByRole('button', { name: 'Mở clip.webm' }).click();
	await expect(page.getByTestId('media-recent-trouble')).toHaveText(
		'Trình duyệt không cho mở lại tệp này.'
	);

	await allowGrant(page);
	await page.evaluate(async () => {
		// Past the stub's lapsed grant, which would refuse this walk too.
		sessionStorage.setItem('tp-test-permission', 'granted');
		const root = await navigator.storage.getDirectory();
		await (await root.getDirectoryHandle('media')).removeEntry('clip.webm');
	});
	await page.getByRole('button', { name: 'Mở clip.webm' }).click();
	await expect(page.getByTestId('media-recent-trouble')).toHaveText('Tệp không còn ở chỗ cũ.');

	await page.getByRole('button', { name: 'Quên clip.webm' }).click();
	await expect(page.getByTestId('media-recents')).toHaveCount(0);
	await expect(page.getByTestId('media-nothing')).toContainText('Chưa mở video nào.');
	expect(await violations()).toEqual([]);
});
