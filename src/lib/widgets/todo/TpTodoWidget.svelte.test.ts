import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { db } from '$lib/core/storage/db';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpTodoWidget from './TpTodoWidget.svelte';
import { createList, createTodo } from './service';

/**
 * doc 07 §5's tile and its states (doc 06 §3, pure-client class).
 *
 * The tile had no component test until Week 8, and writing one found what the
 * notes tile did: a failed read of IndexedDB was caught and shown as `empty`
 * — "no lists yet", or a list "with nothing on it" — to a reader whose lists
 * the tile could not read.
 */

const SIZE: TpTileSize = { w: 3, h: 4, pxW: 320, pxH: 420, tier: 'L' };

function props(over: Record<string, unknown> = {}) {
	return { instanceId: 'wgt_todo', settings: over, size: SIZE };
}

beforeEach(async () => {
	settings.dispose();
	settings.hydrate();
	settings.patch({ locale: 'vi' });
	await db.todos.clear();
	await db.todoLists.clear();
});

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	await db.todos.clear();
	await db.todoLists.clear();
	settings.dispose();
});

describe('the todo tile (doc 07 §5)', () => {
	it('loading: a gauge while the lists are read, never a blank', async () => {
		vi.spyOn(db.todoLists, 'orderBy').mockReturnValue({
			toArray: () => new Promise(() => undefined)
		} as never);
		const screen = render(TpTodoWidget, props());

		await expect.element(screen.getByTestId('todo-loading')).toBeInTheDocument();
	});

	it('empty: no lists at all offers to make the first', async () => {
		const screen = render(TpTodoWidget, props());

		await expect.element(screen.getByTestId('todo-no-lists')).toBeInTheDocument();
		await expect.element(screen.getByTestId('todo-first-list')).toBeInTheDocument();
	});

	it('empty: a list with nothing on it says so', async () => {
		const list = await createList('Chợ', db);
		const screen = render(TpTodoWidget, props({ listId: list.id }));

		await expect.element(screen.getByTestId('todo-empty')).toBeInTheDocument();
	});

	it('ready: the open items of the list', async () => {
		const list = await createList('Chợ', db);
		await createTodo(list.id, 'mua rau');
		const screen = render(TpTodoWidget, props({ listId: list.id }));

		await expect.element(screen.getByText('mua rau')).toBeInTheDocument();
	});

	it('a read of the lists that fails says so, rather than claiming there are none', async () => {
		vi.spyOn(db.todoLists, 'orderBy').mockImplementation(() => {
			throw new Error('idb unavailable');
		});
		const screen = render(TpTodoWidget, props());

		await expect.element(screen.getByText(m['widget.todo.read_failed']())).toBeInTheDocument();
		await expect.element(screen.getByTestId('todo-no-lists')).not.toBeInTheDocument();
	});

	it('a read of the items that fails says so, rather than an empty list', async () => {
		const list = await createList('Chợ', db);
		await createTodo(list.id, 'mua rau');
		vi.spyOn(db.todos, 'where').mockImplementation(() => {
			throw new Error('idb unavailable');
		});
		const screen = render(TpTodoWidget, props({ listId: list.id }));

		await expect.element(screen.getByText(m['widget.todo.read_failed']())).toBeInTheDocument();
		await expect.element(screen.getByTestId('todo-empty')).not.toBeInTheDocument();

		vi.restoreAllMocks();
		await screen.getByRole('button', { name: m['common.retry']() }).click();

		await expect.element(screen.getByText('mua rau')).toBeInTheDocument();
	});
});
