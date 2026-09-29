import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { latestResume, loadPrefs, loadResume, resumeKey, savePrefs, saveResume } from './resume';

/**
 * Media's rows in the `playback` table (doc 09 §3), against real IndexedDB in
 * the test browser: the places are keyed by name and size, the newest twenty
 * are kept — and music's rows, in the same table, are never touched.
 */

const created: TpDb[] = [];

function freshDb(): TpDb {
	const target = createDb(`tilepier-test-${crypto.randomUUID()}`);
	created.push(target);
	return target;
}

afterEach(async () => {
	while (created.length > 0) await created.pop()?.delete();
});

function place(name: string, positionMs = 60_000) {
	return { name, size: 1000, positionMs, durationMs: 600_000 };
}

describe('resumeKey', () => {
	it('is the same for a name however its accents were composed, and differs by size', async () => {
		const composed = await resumeKey('Phim hoạt hình.mp4', 1234);
		const decomposed = await resumeKey('Phim hoạt hình.mp4'.normalize('NFD'), 1234);

		expect(composed).toMatch(/^[0-9a-f]{24}$/);
		expect(decomposed).toBe(composed);
		expect(await resumeKey('Phim hoạt hình.mp4', 1235)).not.toBe(composed);
	});
});

describe('saveResume', () => {
	it('keeps the newest twenty places, and never touches a row that is not media’s', async () => {
		const target = freshDb();
		// Music's rows and the volume are older than every place: an LRU over
		// the whole table would take them first.
		await target.playback.bulkPut([
			{ id: 'music', updatedAt: 1, state: { positionMs: 5 } },
			{ id: 'music:queue', updatedAt: 1, state: { trackIds: [] } },
			{ id: 'media:prefs', updatedAt: 1, state: { volume: 0.5, muted: false } }
		]);
		for (let index = 0; index < 21; index += 1) {
			await saveResume(`key${String(index)}`, place(`${String(index)}.mp4`), 100 + index, target);
		}

		const ids = (await target.playback.toCollection().primaryKeys()).sort();
		expect(ids.filter((id) => id.startsWith('media:pos:'))).toHaveLength(20);
		// The one watched longest ago went.
		expect(ids).not.toContain('media:pos:key0');
		expect(ids).toContain('media:pos:key20');
		expect(ids).toEqual(expect.arrayContaining(['music', 'music:queue', 'media:prefs']));
	});

	it('reads back what it wrote, and a row this build did not write as nothing', async () => {
		const target = freshDb();
		await saveResume('abc', place('Phim.mp4', 61_000), 1, target);
		await target.playback.put({ id: 'media:pos:bad', updatedAt: 2, state: { name: 'x' } });

		expect(await loadResume('abc', target)).toEqual(place('Phim.mp4', 61_000));
		expect(await loadResume('bad', target)).toBeNull();
		expect(await loadResume('none', target)).toBeNull();
	});
});

describe('latestResume', () => {
	it('is the newest place worth coming back to', async () => {
		const target = freshDb();
		await saveResume('old', place('Cũ.mp4'), 1, target);
		await saveResume('mid', place('Giữa.mp4'), 2, target);
		// Finished — put back to the start — so not worth offering.
		await saveResume('new', place('Mới.mp4', 0), 3, target);

		expect((await latestResume(target))?.name).toBe('Giữa.mp4');
	});

	it('is nothing on a fresh profile', async () => {
		expect(await latestResume(freshDb())).toBeNull();
	});
});

describe('prefs', () => {
	it('round-trips the volume and mute', async () => {
		const target = freshDb();
		expect(await loadPrefs(target)).toBeNull();

		await savePrefs({ volume: 0.3, muted: true }, 1, target);

		expect(await loadPrefs(target)).toEqual({ volume: 0.3, muted: true });
	});
});
