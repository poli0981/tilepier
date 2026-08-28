import { describe, expect, it } from 'vitest';
import type { TpTodo, TpTodoList } from '$lib/core/storage/db';
import { countDone, dueState, filterTodos, moveList, resolveList, sortTodos } from './service';

/**
 * doc 07 §5's pure half — ordering, filtering and what a due date means. The
 * Dexie half is in `storage.svelte.test.ts`.
 */

const TODAY = new Date(2026, 7, 27, 12, 0).getTime();

function todo(overrides: Partial<TpTodo> = {}): TpTodo {
	return { id: 't', listId: 'l', text: '', done: false, updatedAt: 0, ...overrides };
}

function list(overrides: Partial<TpTodoList> = {}): TpTodoList {
	return { id: 'l', name: '', order: 0, ...overrides };
}

describe('dueState', () => {
	it('classifies a date against today', () => {
		expect(dueState('2026-08-26', TODAY)).toBe('overdue');
		expect(dueState('2026-08-27', TODAY)).toBe('today');
		expect(dueState('2026-08-28', TODAY)).toBe('upcoming');
	});

	it('treats no date as no date', () => {
		expect(dueState(undefined, TODAY)).toBe('none');
		expect(dueState('', TODAY)).toBe('none');
	});

	it('compares as strings rather than parsing', () => {
		// `new Date('2026-08-30')` is UTC midnight, which puts anyone east of
		// Greenwich a day out. Comparing `YYYY-MM-DD` lexically is exact.
		expect(dueState('2026-12-31', TODAY)).toBe('upcoming');
		expect(dueState('2025-01-01', TODAY)).toBe('overdue');
	});
});

describe('sortTodos', () => {
	it('puts unchecked items before checked ones', () => {
		const rows = [todo({ id: 'a', done: true }), todo({ id: 'b', done: false })];
		expect(sortTodos(rows).map((entry) => entry.id)).toEqual(['b', 'a']);
	});

	it('orders open items by how soon they are due', () => {
		const rows = [
			todo({ id: 'later', due: '2026-09-01' }),
			todo({ id: 'sooner', due: '2026-08-28' })
		];
		expect(sortTodos(rows).map((entry) => entry.id)).toEqual(['sooner', 'later']);
	});

	it('puts undated items after every dated one', () => {
		const rows = [
			todo({ id: 'undated', updatedAt: 99 }),
			todo({ id: 'dated', due: '2030-01-01', updatedAt: 1 })
		];
		expect(sortTodos(rows).map((entry) => entry.id)).toEqual(['dated', 'undated']);
	});

	it('falls back to recency within a group', () => {
		const rows = [todo({ id: 'old', updatedAt: 1 }), todo({ id: 'new', updatedAt: 9 })];
		expect(sortTodos(rows).map((entry) => entry.id)).toEqual(['new', 'old']);
	});

	it('puts the most recently completed at the top of the done group', () => {
		const rows = [
			todo({ id: 'first', done: true, updatedAt: 1 }),
			todo({ id: 'last', done: true, updatedAt: 9 })
		];
		expect(sortTodos(rows).map((entry) => entry.id)).toEqual(['last', 'first']);
	});

	it('returns a copy rather than sorting in place', () => {
		const rows = [todo({ id: 'a', done: true }), todo({ id: 'b' })];
		sortTodos(rows);
		expect(rows[0]?.id).toBe('a');
	});
});

describe('filterTodos', () => {
	const rows = [
		todo({ id: 'overdue', due: '2026-08-20' }),
		todo({ id: 'today', due: '2026-08-27' }),
		todo({ id: 'soon', due: '2026-09-05' }),
		todo({ id: 'undated' }),
		todo({ id: 'finished', done: true, due: '2026-08-20' })
	];

	it('shows everything for `all`', () => {
		expect(filterTodos(rows, 'all', TODAY)).toHaveLength(5);
	});

	it('counts overdue items as today’s problem', () => {
		// Something due yesterday is more today's business than tomorrow's.
		expect(filterTodos(rows, 'today', TODAY).map((entry) => entry.id)).toEqual([
			'overdue',
			'today'
		]);
	});

	it('separates upcoming from undated', () => {
		expect(filterTodos(rows, 'upcoming', TODAY).map((entry) => entry.id)).toEqual(['soon']);
		expect(filterTodos(rows, 'nodate', TODAY).map((entry) => entry.id)).toEqual(['undated']);
	});

	it('keeps completed items out of every open filter', () => {
		for (const filter of ['today', 'upcoming', 'nodate'] as const) {
			expect(
				filterTodos(rows, filter, TODAY).some((entry) => entry.done),
				filter
			).toBe(false);
		}
	});

	it('shows only completed items for `done`', () => {
		expect(filterTodos(rows, 'done', TODAY).map((entry) => entry.id)).toEqual(['finished']);
	});
});

describe('countDone', () => {
	it('counts what the collapsed group holds', () => {
		expect(countDone([todo({ done: true }), todo(), todo({ done: true })])).toBe(2);
		expect(countDone([])).toBe(0);
	});
});

describe('moveList', () => {
	const lists = [list({ id: 'a' }), list({ id: 'b' }), list({ id: 'c' })];

	it('moves a list down and up', () => {
		expect(moveList(lists, 0, 1)).toEqual(['b', 'a', 'c']);
		expect(moveList(lists, 2, 0)).toEqual(['c', 'a', 'b']);
	});

	it('does nothing at the ends, so the buttons can stay simple', () => {
		expect(moveList(lists, 0, -1)).toEqual(['a', 'b', 'c']);
		expect(moveList(lists, 2, 3)).toEqual(['a', 'b', 'c']);
		expect(moveList(lists, 1, 1)).toEqual(['a', 'b', 'c']);
	});

	it('does nothing to an empty set', () => {
		expect(moveList([], 0, 1)).toEqual([]);
	});
});

describe('resolveList', () => {
	const lists = [list({ id: 'first' }), list({ id: 'second' })];

	it('finds the chosen list', () => {
		expect(resolveList(lists, 'second')?.id).toBe('second');
	});

	it('returns nothing when the chosen list is gone', () => {
		// doc 07 §5's edge case: the tile shows `empty` with "choose a list"
		// rather than adopting another one. The user picked *that* list.
		expect(resolveList(lists, 'deleted')).toBeNull();
	});

	it('falls to the first list when none was chosen', () => {
		expect(resolveList(lists, undefined)?.id).toBe('first');
		expect(resolveList(lists, 42)?.id).toBe('first');
	});

	it('has nothing to show when there are no lists', () => {
		expect(resolveList([], undefined)).toBeNull();
		expect(resolveList([], 'anything')).toBeNull();
	});
});
