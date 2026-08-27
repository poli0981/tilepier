import { newId } from '$lib/core/ids';
import { db, type TpDb, type TpTodo, type TpTodoList } from '$lib/core/storage/db';

/**
 * doc 07 §5's data layer.
 *
 * A note on what is reorderable and what is not: `todoLists` carries an
 * `order` field in doc 05 §3 and `todos` does not, so "reorder via native
 * drag" in that section is about the *lists*. Items sort by due date and
 * recency instead, which is what a todo list wants anyway — a manual order
 * inside a list is a fourth thing to maintain, and doc 05 §3's shipped
 * `version(1)` block cannot gain a field to hold it (CLAUDE.md rule 10).
 */

export type TpTodoFilter = 'all' | 'today' | 'upcoming' | 'nodate' | 'done';

export const TODO_FILTERS: readonly TpTodoFilter[] = ['all', 'today', 'upcoming', 'nodate', 'done'];

/** How a due date reads against the clock — and the only thing that decides
 *  the chip's colour, so it is stated once rather than in two components. */
export type TpDueState = 'overdue' | 'today' | 'upcoming' | 'none';

/** `2026-08-30` in the viewer's own zone. Local rather than UTC, for the same
 *  reason the timer's is: "due today" is a question about the user's day.
 *  Graduates into `core` when a third caller wants it (doc 03 §1). */
export function dateKeyOf(at: number | Date): string {
	const date = at instanceof Date ? at : new Date(at);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

export function dueState(due: string | undefined, now: number = Date.now()): TpDueState {
	if (due === undefined || due === '') return 'none';

	const today = dateKeyOf(now);
	// String comparison, which is exact for `YYYY-MM-DD` and avoids parsing a
	// date-only string — `new Date('2026-08-30')` is UTC midnight and would put
	// anyone east of Greenwich a day out.
	if (due < today) return 'overdue';
	if (due === today) return 'today';
	return 'upcoming';
}

/* ────────────────────────────────────────────────────────────────── lists */

export async function listLists(target: TpDb = db): Promise<TpTodoList[]> {
	return target.todoLists.orderBy('order').toArray();
}

export async function createList(name: string, target: TpDb = db): Promise<TpTodoList> {
	const existing = await target.todoLists.orderBy('order').last();
	const list: TpTodoList = {
		id: newId('list'),
		name: name.trim(),
		order: (existing?.order ?? -1) + 1
	};
	await target.todoLists.add(list);
	return list;
}

export async function renameList(id: string, name: string, target: TpDb = db): Promise<void> {
	await target.todoLists.update(id, { name: name.trim() });
}

/**
 * Deletes a list **and its items**.
 *
 * doc 07 §5 says completing a todo is not a soft delete; deleting the list it
 * lives in is not one either. Orphaned rows would be invisible, would never be
 * cleaned up, and would ride along in every backup (doc 05 §6) forever.
 */
export async function deleteList(id: string, target: TpDb = db): Promise<void> {
	await target.transaction('rw', target.todoLists, target.todos, async () => {
		await target.todos.where('listId').equals(id).delete();
		await target.todoLists.delete(id);
	});
}

/** Writes a new order from a full list of ids — the shape a drag produces. */
export async function reorderLists(ids: readonly string[], target: TpDb = db): Promise<void> {
	await target.transaction('rw', target.todoLists, async () => {
		await Promise.all(ids.map((id, index) => target.todoLists.update(id, { order: index })));
	});
}

/** Moves one list to a new index, and returns the resulting id order. Pure, so
 *  the drag can preview without writing. */
export function moveList(
	lists: readonly TpTodoList[],
	from: number,
	to: number
): readonly string[] {
	const ids = lists.map((list) => list.id);
	if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return ids;

	const next = [...ids];
	const [moved] = next.splice(from, 1);
	if (moved !== undefined) next.splice(to, 0, moved);
	return next;
}

/** doc 07 §5's edge case: a tile pointing at a list that has been deleted
 *  shows `empty` with "choose a list", rather than silently adopting another
 *  one — the user picked *that* list. */
export function resolveList(lists: readonly TpTodoList[], listId: unknown): TpTodoList | null {
	if (typeof listId === 'string') {
		return lists.find((list) => list.id === listId) ?? null;
	}
	return lists[0] ?? null;
}

/* ────────────────────────────────────────────────────────────────── items */

export async function listTodos(listId: string, target: TpDb = db): Promise<TpTodo[]> {
	return target.todos.where('listId').equals(listId).toArray();
}

export async function createTodo(
	listId: string,
	text: string,
	due?: string,
	target: TpDb = db
): Promise<TpTodo | null> {
	const trimmed = text.trim();
	// An empty todo is a stray Enter key, not an intention.
	if (trimmed === '') return null;

	const todo: TpTodo = {
		id: newId('todo'),
		listId,
		text: trimmed,
		done: false,
		updatedAt: Date.now(),
		...(due === undefined || due === '' ? {} : { due })
	};
	await target.todos.add(todo);
	return todo;
}

/** doc 07 §5: completing sets `done` and `updatedAt`; there is no soft delete
 *  and nothing else changes. */
export async function setDone(id: string, done: boolean, target: TpDb = db): Promise<void> {
	await target.todos.update(id, { done, updatedAt: Date.now() });
}

export async function updateTodo(
	id: string,
	patch: { text?: string; due?: string },
	target: TpDb = db
): Promise<void> {
	const fields: Partial<TpTodo> = { updatedAt: Date.now() };
	if (patch.text !== undefined) fields.text = patch.text.trim();
	if (patch.due !== undefined && patch.due !== '') fields.due = patch.due;

	await target.todos.update(id, fields);

	// Clearing a date is a *deletion* of the field, not an assignment of
	// `undefined` to it. `exactOptionalPropertyTypes` (doc 20 §2) forbids the
	// latter outright, and `delete` is the more honest of the two anyway: a
	// record with no `due` key is what "no date" means, and it is what a backup
	// export (doc 05 §6) then carries.
	//
	// An empty string is the clear; `undefined` in the patch means "leave it
	// alone", which is why the two cases cannot collapse into one.
	if (patch.due === '') {
		await target.todos
			.where('id')
			.equals(id)
			.modify((todo) => {
				delete todo.due;
			});
	}
}

export async function deleteTodo(id: string, target: TpDb = db): Promise<void> {
	await target.todos.delete(id);
}

/** doc 07 §5's bulk action. Returns how many went, so the caller can say. */
export async function clearDone(listId: string, target: TpDb = db): Promise<number> {
	return target.todos
		.where('listId')
		.equals(listId)
		.and((todo) => todo.done)
		.delete();
}

/* ─────────────────────────────────────────────────────────── presentation */

/**
 * doc 07 §5's tile order: "unchecked first, checked collapse under done (n)".
 *
 * Within the unchecked half, dated items come before undated ones and sort by
 * how soon they are due — which is the order a person reads a todo list in.
 * Undated items fall back to recency, and completed ones to when they were
 * completed, most recent first, so the last thing ticked is at the top of the
 * collapsed group.
 */
export function sortTodos(todos: readonly TpTodo[]): TpTodo[] {
	return [...todos].sort((a, b) => {
		if (a.done !== b.done) return a.done ? 1 : -1;
		if (a.done) return b.updatedAt - a.updatedAt;

		const aDue = a.due ?? '';
		const bDue = b.due ?? '';
		if (aDue !== bDue) {
			// An undated item sorts after every dated one, whatever the date.
			if (aDue === '') return 1;
			if (bDue === '') return -1;
			return aDue < bDue ? -1 : 1;
		}
		return b.updatedAt - a.updatedAt;
	});
}

/** doc 07 §5's detail filters. */
export function filterTodos(
	todos: readonly TpTodo[],
	filter: TpTodoFilter,
	now: number = Date.now()
): TpTodo[] {
	if (filter === 'all') return [...todos];
	if (filter === 'done') return todos.filter((todo) => todo.done);

	const open = todos.filter((todo) => !todo.done);
	if (filter === 'nodate') return open.filter((todo) => dueState(todo.due, now) === 'none');
	if (filter === 'upcoming') return open.filter((todo) => dueState(todo.due, now) === 'upcoming');

	// `today` includes what is already overdue: something that was due
	// yesterday is more today's problem than tomorrow's.
	return open.filter((todo) => {
		const state = dueState(todo.due, now);
		return state === 'today' || state === 'overdue';
	});
}

export function countDone(todos: readonly TpTodo[]): number {
	return todos.filter((todo) => todo.done).length;
}
