import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { createNote, deleteNote, listNotes, saveNote, setPinned } from './service';

/**
 * The Dexie half of doc 07 §4. Browser project — the `.svelte.` infix selects
 * it (doc 19 §1) — against a throwaway database rather than the user's own.
 */

const created: TpDb[] = [];

function freshDb(): TpDb {
	const db = createDb(`tilepier-notes-${crypto.randomUUID()}`);
	created.push(db);
	return db;
}

/** `updatedAt` is a millisecond stamp, and two writes inside one millisecond
 *  are indistinguishable to a sort. A two-millisecond gap is the cheapest way
 *  to make an ordering assertion mean something. */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 2));
}

afterEach(async () => {
	while (created.length > 0) {
		const db = created.pop();
		await db?.delete();
	}
});

describe('the note lifecycle', () => {
	it('creates a note with a derived title and a timestamp', async () => {
		const db = freshDb();
		const note = await createNote('# Shopping\nmilk', db);

		expect(note.title).toBe('Shopping');
		expect(note.updatedAt).toBeGreaterThan(0);
		expect(await db.notes.count()).toBe(1);
	});

	it('re-derives the title on every save', async () => {
		// The title is stored so the sidebar can render without loading bodies,
		// which only works if the write keeps it honest.
		const db = freshDb();
		const note = await createNote('First', db);

		await saveNote(note.id, '# Renamed\nbody', db);

		const stored = await db.notes.get(note.id);
		expect(stored?.title).toBe('Renamed');
		expect(stored?.body).toBe('# Renamed\nbody');
	});

	it('moves a saved note to the front of the list', async () => {
		const db = freshDb();
		const first = await createNote('one', db);
		await tick();
		await createNote('two', db);

		await tick();
		await saveNote(first.id, 'one, edited', db);

		expect((await listNotes(db))[0]?.id).toBe(first.id);
	});

	it('floats pinned notes above the rest without reshuffling them', async () => {
		const db = freshDb();
		const a = await createNote('a', db);
		await tick();
		const b = await createNote('b', db);
		await tick();
		await createNote('c', db);

		await setPinned(a.id, true, db);

		const order = (await listNotes(db)).map((note) => note.body);
		// `a` is pinned so it leads; the rest keep their recency order.
		expect(order).toEqual(['a', 'c', 'b']);
		expect((await db.notes.get(b.id))?.pinned).toBeUndefined();
	});

	it('unpins again', async () => {
		const db = freshDb();
		const note = await createNote('a', db);

		await setPinned(note.id, true, db);
		await setPinned(note.id, false, db);

		expect((await db.notes.get(note.id))?.pinned).toBe(false);
	});

	it('deletes without touching its neighbours', async () => {
		const db = freshDb();
		const a = await createNote('a', db);
		await createNote('b', db);

		await deleteNote(a.id, db);

		const rows = await listNotes(db);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.body).toBe('b');
	});

	it('says nothing and does nothing for an id that is not there', async () => {
		// A double-click on delete, or a note removed in another tab.
		const db = freshDb();
		await expect(deleteNote('note_gone', db)).resolves.toBeUndefined();
		await expect(saveNote('note_gone', 'x', db)).resolves.toBeUndefined();
	});

	it('starts empty', async () => {
		expect(await listNotes(freshDb())).toEqual([]);
	});
});
