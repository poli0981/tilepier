import Dexie from 'dexie';
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

describe('schema', () => {
	it('opens at version 2 and declares the doc 05 §3 tables', async () => {
		const db = freshDb();
		await db.open();

		expect(db.verno).toBe(2);
		const names = db.tables.map((t) => t.name).sort();
		expect(names).toEqual(
			[
				'apiCache',
				'events',
				'focusSessions',
				'fsaHandles',
				'fxHistory',
				'notes',
				'playback',
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

/**
 * The version 1 schema exactly as it shipped (doc 05 §3), copied rather than
 * imported: these tests are about the database a reader *already has*, and a
 * later edit to `db.ts` must not quietly change what they start from.
 */
const V1 = {
	notes: 'id, updatedAt',
	todos: 'id, listId, done, updatedAt',
	todoLists: 'id, order',
	events: 'id, dateKey',
	playlists: 'id, order',
	tracks: 'id, addedAt, title, artist',
	trackBlobs: 'id',
	fsaHandles: 'id',
	savedPlaces: 'id, name',
	focusSessions: 'id, dateKey',
	apiCache: 'key, cachedAt',
	fxHistory: 'dateKey'
};

describe('migrations (doc 19 §3.3)', () => {
	it('v1 → v2 adds `playback` and keeps every row', async () => {
		// A brand-new database skips upgrade paths entirely, so the v1 database
		// has to be built by a v1-only Dexie first, the way a reader's was.
		const name = `tilepier-test-${crypto.randomUUID()}`;
		const old = new Dexie(name);
		old.version(1).stores(V1);
		await old.table('notes').put({ id: 'n1', title: 'kept', body: '', updatedAt: 1 });
		await old.table('tracks').put({
			id: 't1',
			source: 'fsa',
			title: 'Bài cũ',
			artist: '',
			album: '',
			addedAt: 1
		});
		old.close();

		const db = createDb(name);
		created.push(db);
		await db.open();

		expect(db.verno).toBe(2);
		expect((await db.notes.get('n1'))?.title).toBe('kept');
		expect((await db.tracks.get('t1'))?.title).toBe('Bài cũ');
		await db.playback.put({ id: 'music', updatedAt: 1, state: { positionMs: 0 } });
		expect(await db.playback.count()).toBe(1);
	});

	it('still opens under a version 1 build, for a rollback', async () => {
		// The release checklist's rollback runbook deploys the previous build,
		// whose Dexie knows only version 1. It has to open the upgraded
		// database and read what it knows, rather than fail the whole app.
		const name = `tilepier-test-${crypto.randomUUID()}`;
		const db = createDb(name);
		created.push(db);
		await db.notes.put({ id: 'n1', title: 'kept', body: '', updatedAt: 1 });
		await db.playback.put({ id: 'music', updatedAt: 1, state: {} });
		db.close();

		const old = new Dexie(name);
		old.version(1).stores(V1);
		expect((await old.table('notes').get('n1'))?.title).toBe('kept');
		old.close();
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
