import { afterEach, describe, expect, it } from 'vitest';
import { createDb, pruneApiCache, type TpDb } from './db';

/**
 * doc 19 §3.3 wants a test per migration; doc 05 §3 says apiCache is pruned on
 * startup. Neither existed, and `pruneApiCache` had no caller at all — a prune
 * nobody runs and nobody checks is just a comment.
 *
 * Browser project: real IndexedDB, so this exercises Dexie rather than a stub.
 */

const created: TpDb[] = [];

function freshDb(): TpDb {
	const db = createDb(`tilepier-test-${crypto.randomUUID()}`);
	created.push(db);
	return db;
}

afterEach(async () => {
	while (created.length > 0) {
		const db = created.pop();
		await db?.delete();
	}
});

describe('schema v1', () => {
	it('opens and declares the doc 05 §3 tables', async () => {
		const db = freshDb();
		await db.open();

		const names = db.tables.map((t) => t.name).sort();
		expect(names).toEqual(
			[
				'apiCache',
				'events',
				'focusSessions',
				'fsaHandles',
				'fxHistory',
				'notes',
				'playlists',
				'savedPlaces',
				'todoLists',
				'todos',
				'trackBlobs',
				'tracks'
			].sort()
		);
	});

	it('round-trips a row through the primary key', async () => {
		const db = freshDb();
		await db.notes.put({ id: 'n1', title: 'a', body: 'b', updatedAt: 1, pinned: false });

		expect((await db.notes.get('n1'))?.title).toBe('a');
	});
});

describe('pruneApiCache', () => {
	it('drops entries older than seven days and keeps the rest', async () => {
		const db = freshDb();
		const now = Date.parse('2026-08-19T00:00:00Z');
		const day = 86_400_000;
		await db.apiCache.bulkPut([
			{ key: 'fresh', cachedAt: now - day, payload: {} },
			{ key: 'stale', cachedAt: now - 8 * day, payload: {} }
		]);

		const deleted = await pruneApiCache(now, db);

		expect(deleted).toBe(1);
		expect(await db.apiCache.get('fresh')).toBeDefined();
		expect(await db.apiCache.get('stale')).toBeUndefined();
	});

	it('caps the table at 500 rows, oldest first', async () => {
		const db = freshDb();
		const now = Date.parse('2026-08-19T00:00:00Z');
		await db.apiCache.bulkPut(
			Array.from({ length: 520 }, (_, i) => ({
				key: `k${i}`,
				cachedAt: now - (520 - i) * 1000,
				payload: {}
			}))
		);

		await pruneApiCache(now, db);

		expect(await db.apiCache.count()).toBe(500);
		// The 20 oldest went, not an arbitrary 20.
		expect(await db.apiCache.get('k0')).toBeUndefined();
		expect(await db.apiCache.get('k519')).toBeDefined();
	});

	it('does nothing to an empty table', async () => {
		const db = freshDb();

		expect(await pruneApiCache(Date.now(), db)).toBe(0);
	});
});
