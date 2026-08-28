import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { createEvent, deleteEvent, listEventsInRange, listEventsOn, updateEvent } from './service';
import { EVENT_LIMITS } from './types';

/**
 * The Dexie half of doc 07 §6. Browser project — the `.svelte.` infix selects
 * it (doc 19 §1) — against a throwaway database, so this exercises real
 * IndexedDB rather than a stub of it.
 *
 * `events` ships in `version(1)` (doc 05 §3) and needs no migration; what is
 * worth checking is the range query the grid leans on, and the two places a
 * record can go wrong — a blank title, and a note that has to *disappear*
 * rather than become `undefined`.
 */

const created: TpDb[] = [];

function freshDb(): TpDb {
	const db = createDb(`tilepier-calendar-${crypto.randomUUID()}`);
	created.push(db);
	return db;
}

afterEach(async () => {
	while (created.length > 0) {
		const db = created.pop();
		await db?.delete();
	}
});

describe('createEvent', () => {
	it('stores a titled event on the day it was given', async () => {
		const db = freshDb();
		const created = await createEvent({ dateKey: '2026-08-28', title: 'Họp nhóm' }, db);

		expect(created?.title).toBe('Họp nhóm');
		expect(created?.dateKey).toBe('2026-08-28');
		expect(await listEventsOn('2026-08-28', db)).toHaveLength(1);
	});

	it('refuses a blank title rather than storing an unnamed row', async () => {
		const db = freshDb();
		expect(await createEvent({ dateKey: '2026-08-28', title: '   ' }, db)).toBeNull();
		expect(await listEventsOn('2026-08-28', db)).toHaveLength(0);
	});

	it('trims, and caps a very long title', async () => {
		const db = freshDb();
		const created = await createEvent(
			{ dateKey: '2026-08-28', title: `  ${'x'.repeat(400)}  ` },
			db
		);
		expect(created?.title).toHaveLength(EVENT_LIMITS.titleMax);
	});

	it('omits the note key entirely when there is no note', async () => {
		// doc 07 §5 rule 5: `exactOptionalPropertyTypes` forbids assigning
		// `undefined`, and a missing key is what an export then carries.
		const db = freshDb();
		const created = await createEvent({ dateKey: '2026-08-28', title: 'Giỗ', note: '  ' }, db);
		expect(created).not.toBeNull();
		expect(Object.hasOwn(created as object, 'note')).toBe(false);
	});

	it('keeps a note when there is one', async () => {
		const db = freshDb();
		const created = await createEvent({ dateKey: '2026-08-28', title: 'Giỗ', note: 'mua hoa' }, db);
		expect(created?.note).toBe('mua hoa');
	});
});

describe('listEventsInRange', () => {
	it('returns the days inside the range and nothing outside it', async () => {
		const db = freshDb();
		for (const dateKey of ['2026-07-31', '2026-08-01', '2026-08-15', '2026-08-31', '2026-09-01']) {
			await createEvent({ dateKey, title: dateKey }, db);
		}

		const rows = await listEventsInRange('2026-08-01', '2026-08-31', db);
		expect(rows.map((r) => r.dateKey).sort()).toEqual(['2026-08-01', '2026-08-15', '2026-08-31']);
	});

	it('is inclusive at both ends', async () => {
		const db = freshDb();
		await createEvent({ dateKey: '2026-08-01', title: 'first' }, db);
		await createEvent({ dateKey: '2026-08-31', title: 'last' }, db);

		expect(await listEventsInRange('2026-08-01', '2026-08-31', db)).toHaveLength(2);
	});

	it('spans a year boundary, which a string range only does because of the padding', async () => {
		// `2026-12-28` < `2027-01-03` lexicographically only because the months
		// and days are zero-padded — which is why `dateKeyOf` pads.
		const db = freshDb();
		await createEvent({ dateKey: '2026-12-28', title: 'a' }, db);
		await createEvent({ dateKey: '2027-01-03', title: 'b' }, db);

		expect(await listEventsInRange('2026-12-28', '2027-01-03', db)).toHaveLength(2);
	});

	it('is empty rather than throwing when nothing is stored', async () => {
		expect(await listEventsInRange('2026-08-01', '2026-08-31', freshDb())).toEqual([]);
	});
});

describe('updateEvent', () => {
	it('renames without touching the day', async () => {
		const db = freshDb();
		const created = await createEvent({ dateKey: '2026-08-28', title: 'Cũ' }, db);
		const updated = await updateEvent(created?.id ?? '', { title: 'Mới' }, db);

		expect(updated?.title).toBe('Mới');
		expect(updated?.dateKey).toBe('2026-08-28');
	});

	it('moves an event to another day', async () => {
		const db = freshDb();
		const created = await createEvent({ dateKey: '2026-08-28', title: 'Họp' }, db);
		await updateEvent(created?.id ?? '', { dateKey: '2026-08-30' }, db);

		expect(await listEventsOn('2026-08-28', db)).toHaveLength(0);
		expect(await listEventsOn('2026-08-30', db)).toHaveLength(1);
	});

	it('removes the note key when the note is cleared', async () => {
		// The reason `put` is used rather than `update`: an `update` with
		// `{ note: undefined }` leaves the old value in place, so a cleared note
		// would silently come back on the next read.
		const db = freshDb();
		const created = await createEvent({ dateKey: '2026-08-28', title: 'Giỗ', note: 'mua hoa' }, db);
		await updateEvent(created?.id ?? '', { note: '' }, db);

		const stored = await db.events.get(created?.id ?? '');
		expect(stored).toBeDefined();
		expect(Object.hasOwn(stored as object, 'note')).toBe(false);
	});

	it('leaves an untouched note alone', async () => {
		const db = freshDb();
		const created = await createEvent({ dateKey: '2026-08-28', title: 'Giỗ', note: 'mua hoa' }, db);
		const updated = await updateEvent(created?.id ?? '', { title: 'Giỗ ông' }, db);
		expect(updated?.note).toBe('mua hoa');
	});

	it('refuses an edit that would blank the title, and changes nothing', async () => {
		const db = freshDb();
		const created = await createEvent({ dateKey: '2026-08-28', title: 'Họp' }, db);

		expect(await updateEvent(created?.id ?? '', { title: '  ' }, db)).toBeNull();
		expect((await db.events.get(created?.id ?? ''))?.title).toBe('Họp');
	});

	it('returns null for an id that is not there', async () => {
		expect(await updateEvent('evt_missing', { title: 'x' }, freshDb())).toBeNull();
	});
});

describe('deleteEvent', () => {
	it('removes just that one', async () => {
		const db = freshDb();
		const a = await createEvent({ dateKey: '2026-08-28', title: 'A' }, db);
		await createEvent({ dateKey: '2026-08-28', title: 'B' }, db);

		await deleteEvent(a?.id ?? '', db);
		const left = await listEventsOn('2026-08-28', db);
		expect(left.map((r) => r.title)).toEqual(['B']);
	});

	it('is quiet about an id that is already gone', async () => {
		const db = freshDb();
		await expect(deleteEvent('evt_missing', db)).resolves.toBeUndefined();
	});
});
