import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type TpDb } from '$lib/core/storage/db';
import {
	clearDone,
	createList,
	createTodo,
	deleteList,
	deleteTodo,
	listLists,
	listTodos,
	renameList,
	reorderLists,
	setDone,
	updateTodo
} from './service';

/**
 * The Dexie half of doc 07 §5. Browser project — the `.svelte.` infix selects
 * it (doc 19 §1) — against a throwaway database.
 */

const created: TpDb[] = [];

function freshDb(): TpDb {
	const db = createDb(`tilepier-todo-${crypto.randomUUID()}`);
	created.push(db);
	return db;
}

afterEach(async () => {
	while (created.length > 0) {
		const db = created.pop();
		await db?.delete();
	}
});

describe('lists', () => {
	it('appends new lists in creation order', async () => {
		const db = freshDb();
		await createList('One', db);
		await createList('Two', db);
		await createList('Three', db);

		expect((await listLists(db)).map((list) => list.name)).toEqual(['One', 'Two', 'Three']);
	});

	it('trims the name it is given', async () => {
		const db = freshDb();
		const list = await createList('  Padded  ', db);
		expect(list.name).toBe('Padded');
	});

	it('renames', async () => {
		const db = freshDb();
		const list = await createList('Before', db);

		await renameList(list.id, ' After ', db);

		expect((await db.todoLists.get(list.id))?.name).toBe('After');
	});

	it('reorders from a full set of ids', async () => {
		const db = freshDb();
		const a = await createList('A', db);
		const b = await createList('B', db);
		const c = await createList('C', db);

		await reorderLists([c.id, a.id, b.id], db);

		expect((await listLists(db)).map((list) => list.name)).toEqual(['C', 'A', 'B']);
	});

	it('deletes a list and everything on it', async () => {
		// doc 07 §5 has no soft delete. Orphaned items would be invisible, never
		// cleaned up, and would ride along in every backup (doc 05 §6) forever.
		const db = freshDb();
		const keep = await createList('Keep', db);
		const drop = await createList('Drop', db);

		await createTodo(drop.id, 'gone with it', undefined, db);
		await createTodo(keep.id, 'stays', undefined, db);

		await deleteList(drop.id, db);

		expect((await listLists(db)).map((list) => list.name)).toEqual(['Keep']);
		expect(await db.todos.count()).toBe(1);
		expect((await listTodos(keep.id, db))[0]?.text).toBe('stays');
	});
});

describe('items', () => {
	it('creates an item, trimmed, with a timestamp', async () => {
		const db = freshDb();
		const list = await createList('L', db);

		const todo = await createTodo(list.id, '  buy milk  ', undefined, db);

		expect(todo?.text).toBe('buy milk');
		expect(todo?.done).toBe(false);
		expect(todo?.updatedAt).toBeGreaterThan(0);
		expect(todo?.due).toBeUndefined();
	});

	it('refuses an empty item rather than storing a blank row', async () => {
		// A stray Enter key is not an intention.
		const db = freshDb();
		const list = await createList('L', db);

		expect(await createTodo(list.id, '   ', undefined, db)).toBeNull();
		expect(await db.todos.count()).toBe(0);
	});

	it('keeps a due date when it is given one', async () => {
		const db = freshDb();
		const list = await createList('L', db);

		const todo = await createTodo(list.id, 'ship it', '2026-09-01', db);
		expect(todo?.due).toBe('2026-09-01');
	});

	it('completes without deleting, and stamps the time', async () => {
		const db = freshDb();
		const list = await createList('L', db);
		const todo = await createTodo(list.id, 'task', undefined, db);
		const before = todo?.updatedAt ?? 0;

		await new Promise((resolve) => setTimeout(resolve, 2));
		await setDone(todo!.id, true, db);

		const stored = await db.todos.get(todo!.id);
		expect(stored?.done).toBe(true);
		expect(stored?.updatedAt).toBeGreaterThan(before);
	});

	it('un-completes again', async () => {
		const db = freshDb();
		const list = await createList('L', db);
		const todo = await createTodo(list.id, 'task', undefined, db);

		await setDone(todo!.id, true, db);
		await setDone(todo!.id, false, db);

		expect((await db.todos.get(todo!.id))?.done).toBe(false);
	});

	it('edits the text and clears a date with an empty string', async () => {
		const db = freshDb();
		const list = await createList('L', db);
		const todo = await createTodo(list.id, 'draft', '2026-09-01', db);

		await updateTodo(todo!.id, { text: '  final  ' }, db);
		expect((await db.todos.get(todo!.id))?.text).toBe('final');

		await updateTodo(todo!.id, { due: '' }, db);
		expect((await db.todos.get(todo!.id))?.due).toBeUndefined();
	});

	it('leaves the date alone when the patch does not mention it', async () => {
		const db = freshDb();
		const list = await createList('L', db);
		const todo = await createTodo(list.id, 'draft', '2026-09-01', db);

		await updateTodo(todo!.id, { text: 'renamed' }, db);

		expect((await db.todos.get(todo!.id))?.due).toBe('2026-09-01');
	});

	it('deletes one item', async () => {
		const db = freshDb();
		const list = await createList('L', db);
		const todo = await createTodo(list.id, 'gone', undefined, db);
		await createTodo(list.id, 'stays', undefined, db);

		await deleteTodo(todo!.id, db);

		expect((await listTodos(list.id, db)).map((entry) => entry.text)).toEqual(['stays']);
	});

	it('reads only the items of the list it was asked for', async () => {
		const db = freshDb();
		const a = await createList('A', db);
		const b = await createList('B', db);
		await createTodo(a.id, 'in a', undefined, db);
		await createTodo(b.id, 'in b', undefined, db);

		expect((await listTodos(a.id, db)).map((entry) => entry.text)).toEqual(['in a']);
	});
});

describe('clearDone', () => {
	it('sweeps the completed items of one list only', async () => {
		const db = freshDb();
		const a = await createList('A', db);
		const b = await createList('B', db);

		const first = await createTodo(a.id, 'done here', undefined, db);
		await createTodo(a.id, 'still open', undefined, db);
		const other = await createTodo(b.id, 'done there', undefined, db);

		await setDone(first!.id, true, db);
		await setDone(other!.id, true, db);

		const removed = await clearDone(a.id, db);

		expect(removed).toBe(1);
		expect((await listTodos(a.id, db)).map((entry) => entry.text)).toEqual(['still open']);
		// The other list is untouched, which is the whole point of scoping it.
		expect(await listTodos(b.id, db)).toHaveLength(1);
	});

	it('sweeps nothing when nothing is done', async () => {
		const db = freshDb();
		const list = await createList('A', db);
		await createTodo(list.id, 'open', undefined, db);

		expect(await clearDone(list.id, db)).toBe(0);
	});
});
