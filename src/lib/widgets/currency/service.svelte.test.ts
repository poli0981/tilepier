import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FX_PAYLOAD } from '$lib/core/__fixtures__/fx';
import { createDb, pruneApiCache, type TpDb } from '$lib/core/storage/db';
import { mirrorFxSnapshot, MIRROR_MAX_DAYS, readMirroredHistory } from './service';

/**
 * The half of the currency service that touches Dexie, in the browser project.
 *
 * The rest is pure and lives in `service.test.ts` under node. The split is the
 * repo's usual one (`storage/db.svelte.test.ts` does the same) and it matters
 * here: a fake IndexedDB would test the fake.
 */

/** 2026-08-31T10:00:00Z — the day `__fixtures__/fx.ts` was recorded. */
const NOW = Date.parse('2026-08-31T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

let db: TpDb;

beforeEach(() => {
	db = createDb(`tilepier-fxm-${crypto.randomUUID()}`);
});

afterEach(async () => {
	vi.restoreAllMocks();
	db.close();
	await db.delete();
});

describe('mirroring the daily table', () => {
	it('writes one row, keyed on the day upstream published', async () => {
		// `asOf` and not our clock, for the same reason the Worker keys its
		// snapshot that way: the ten minutes after UTC midnight would otherwise
		// file yesterday's table under today.
		await mirrorFxSnapshot(FX_PAYLOAD, db);

		const rows = await db.fxHistory.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.dateKey).toBe('2026-08-31');
		expect(rows[0]?.rates['VND']).toBe(FX_PAYLOAD.rates['VND']);
	});

	it('writes once per published day, however often the tile revalidates', async () => {
		await mirrorFxSnapshot(FX_PAYLOAD, db);
		await mirrorFxSnapshot(FX_PAYLOAD, db);

		expect(await db.fxHistory.count()).toBe(1);
	});

	it('keeps a year plus slack and drops the oldest past it', async () => {
		// `pruneApiCache` deliberately leaves this table alone, so the bound lives
		// with the code that writes it. Unbounded is ~1.8 MB a year on a phone.
		const over = MIRROR_MAX_DAYS + 3;
		for (let i = over - 1; i >= 0; i--) {
			await mirrorFxSnapshot({ ...FX_PAYLOAD, asOf: NOW - i * DAY }, db);
		}

		expect(await db.fxHistory.count()).toBe(MIRROR_MAX_DAYS);
		const keys = (await db.fxHistory.orderBy('dateKey').primaryKeys()) as string[];
		// The newest survives and the oldest three are gone.
		expect(keys.at(-1)).toBe('2026-08-31');
		expect(keys[0]).toBe(new Date(NOW - (MIRROR_MAX_DAYS - 1) * DAY).toISOString().slice(0, 10));
	});

	it('logs and carries on when Dexie refuses', async () => {
		// The rates on screen are already right; the only thing lost is a day of
		// history nobody has asked for yet. Taking the tile down for that would be
		// the wrong trade.
		db.close();

		await expect(mirrorFxSnapshot(FX_PAYLOAD, db)).resolves.toBeUndefined();
	});

	it('is left alone by the startup prune', async () => {
		// The assertion that keeps someone from "fixing" the omission in
		// `pruneApiCache`. These snapshots are not derivable from a request.
		await mirrorFxSnapshot({ ...FX_PAYLOAD, asOf: NOW - 300 * DAY }, db);
		await db.apiCache.put({ key: 'wx:v1:old', cachedAt: NOW - 30 * DAY, payload: { n: 1 } });

		await pruneApiCache(NOW, db);

		expect(await db.fxHistory.count()).toBe(1);
		expect(await db.apiCache.count()).toBe(0);
	});
});

describe('reading the mirror back', () => {
	it('assembles the same window a fetch would, from the device', async () => {
		await mirrorFxSnapshot({ ...FX_PAYLOAD, asOf: NOW - 2 * DAY }, db);
		await mirrorFxSnapshot({ ...FX_PAYLOAD, asOf: NOW }, db);

		const points = await readMirroredHistory('USD', 'VND', 4, NOW, db);

		expect(points.map((p) => new Date(p.at).toISOString().slice(0, 10))).toEqual([
			'2026-08-28',
			'2026-08-29',
			'2026-08-30',
			'2026-08-31'
		]);
		expect(points.map((p) => p.rate)).toEqual([
			null,
			FX_PAYLOAD.rates['VND'],
			null,
			FX_PAYLOAD.rates['VND']
		]);
	});

	it('answers a pair the reader has never opened, which is the whole point', async () => {
		// `swr` caches the history that was *fetched*; one daily table answers
		// every pair, so the mirror can serve a window `apiCache` knows nothing
		// about. That is what makes this worth a second write path.
		await mirrorFxSnapshot(FX_PAYLOAD, db);

		const points = await readMirroredHistory('EUR', 'JPY', 1, NOW, db);
		const expected = (FX_PAYLOAD.rates['JPY'] as number) / (FX_PAYLOAD.rates['EUR'] as number);

		expect(points[0]?.rate).toBeCloseTo(expected, 9);
	});

	it('reports a gap for a code that day did not quote', async () => {
		await mirrorFxSnapshot(FX_PAYLOAD, db);
		const points = await readMirroredHistory('USD', 'ZWL', 1, NOW, db);

		expect(points[0]?.rate).toBeNull();
	});

	it('returns an empty window rather than throwing when Dexie is gone', async () => {
		db.close();
		await expect(readMirroredHistory('USD', 'VND', 7, NOW, db)).resolves.toEqual([]);
	});
});
