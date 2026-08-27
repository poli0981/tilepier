<script lang="ts">
	import { untrack } from 'svelte';
	import { logEntry } from '$lib/core/log-buffer';
	import type { TpTodo, TpTodoList } from '$lib/core/storage/db';
	import type { TpDetailProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		TODO_FILTERS,
		clearDone,
		createList,
		createTodo,
		deleteList,
		deleteTodo,
		dueState,
		filterTodos,
		listLists,
		listTodos,
		moveList,
		renameList,
		reorderLists,
		setDone,
		sortTodos,
		updateTodo,
		type TpTodoFilter
	} from './service';

	/**
	 * doc 07 §5 — the detail: every list, the filters, bulk clear-done, and the
	 * editing the tile deliberately cannot do.
	 *
	 * Reordering is by list, not by item: doc 05 §3 gives `todoLists` an
	 * `order` field and `todos` none, and a shipped `version(1)` block cannot
	 * gain one (CLAUDE.md rule 10). Buttons rather than HTML5 drag — a drag
	 * handle that only works with a mouse is not a control, and two arrows are
	 * operable from a keyboard, a screen reader and a phone alike.
	 */
	let { settings: tileSettings, onUpdateSettings }: TpDetailProps = $props();

	let lists = $state<TpTodoList[] | null>(null);
	let todos = $state<TpTodo[]>([]);
	let selectedId = $state<string | null>(null);
	let filter = $state<TpTodoFilter>('all');
	let text = $state('');
	let due = $state('');
	let renaming = $state<string | null>(null);
	let renameText = $state('');
	let confirmingDelete = $state<string | null>(null);

	const selected = $derived((lists ?? []).find((list) => list.id === selectedId) ?? null);
	const visible = $derived(sortTodos(filterTodos(todos, filter)));
	const tileListId = $derived(
		typeof tileSettings['listId'] === 'string' ? tileSettings['listId'] : null
	);

	async function reloadLists(keep = selectedId): Promise<void> {
		const rows = await listLists();
		lists = rows;
		selectedId = (rows.find((list) => list.id === keep) ?? rows[0] ?? null)?.id ?? null;
	}

	async function reloadTodos(): Promise<void> {
		todos = selectedId === null ? [] : await listTodos(selectedId);
	}

	$effect(() => {
		// Reads the lists once per mount. Untracked for the reason doc 06 §5
		// rule 7 gives and the notes detail learned the hard way: `reloadLists`
		// reads `selectedId` through a default argument, so a tracked body would
		// re-read the database on every click in the sidebar.
		let cancelled = false;

		untrack(() => {
			// Opens on the list the tile is showing, which is the one the user was
			// looking at when they expanded it. The items follow from the effect
			// below, which keys on `selectedId` — loading them here as well would
			// be a second read of the same rows.
			reloadLists(tileListId).catch((error: unknown) => {
				if (cancelled) return;
				logEntry('warn', 'could not read todo lists', { src: 'widget', error });
				lists = [];
			});
		});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		// Re-reads the items when the chosen list changes. Keyed on the id alone
		// so an unrelated rename does not trigger a read.
		const id = selectedId;
		let cancelled = false;

		void (id === null ? Promise.resolve([]) : listTodos(id)).then((rows) => {
			if (!cancelled) todos = rows;
		});

		return () => {
			cancelled = true;
		};
	});

	async function addList(): Promise<void> {
		const created = await createList(m['widget.todo.new_list']());
		await reloadLists(created.id);
	}

	async function removeList(id: string): Promise<void> {
		await deleteList(id);
		confirmingDelete = null;
		await reloadLists(id === selectedId ? null : selectedId);
	}

	async function commitRename(id: string): Promise<void> {
		if (renameText.trim() !== '') await renameList(id, renameText);
		renaming = null;
		await reloadLists(id);
	}

	async function move(index: number, delta: number): Promise<void> {
		const rows = lists ?? [];
		const order = moveList(rows, index, index + delta);
		await reorderLists(order);
		await reloadLists();
	}

	async function add(): Promise<void> {
		if (selectedId === null) return;
		const created = await createTodo(selectedId, text, due === '' ? undefined : due);
		if (created === null) return;

		text = '';
		due = '';
		todos = [...todos, created];
	}

	async function toggle(todo: TpTodo): Promise<void> {
		const next = !todo.done;
		todos = todos.map((entry) =>
			entry.id === todo.id ? { ...entry, done: next, updatedAt: Date.now() } : entry
		);
		await setDone(todo.id, next);
	}

	async function editText(todo: TpTodo, value: string): Promise<void> {
		if (value.trim() === '' || value === todo.text) return;
		await updateTodo(todo.id, { text: value });
		await reloadTodos();
	}

	async function editDue(todo: TpTodo, value: string): Promise<void> {
		await updateTodo(todo.id, { due: value });
		await reloadTodos();
	}

	async function remove(todo: TpTodo): Promise<void> {
		await deleteTodo(todo.id);
		todos = todos.filter((entry) => entry.id !== todo.id);
	}

	async function sweep(): Promise<void> {
		if (selectedId === null) return;
		await clearDone(selectedId);
		await reloadTodos();
	}

	function filterLabel(value: TpTodoFilter): string {
		return m[`widget.todo.filter.${value}`]();
	}
</script>

<div class="tp-todod">
	<aside class="tp-todod__lists">
		<div class="tp-todod__head">
			<h3>{m['widget.todo.lists']()}</h3>
			<button
				type="button"
				aria-label={m['widget.todo.new_list']()}
				data-testid="todo-new-list"
				onclick={() => void addList()}
			>
				<TpIcon name="plus" size={16} />
			</button>
		</div>

		{#if lists !== null && lists.length === 0}
			<p class="tp-todod__note" data-testid="todo-detail-no-lists">
				{m['widget.todo.no_lists']()}
			</p>
		{/if}

		<ul>
			{#each lists ?? [] as list, index (list.id)}
				<li class:selected={list.id === selectedId}>
					{#if renaming === list.id}
						<input
							class="tp-todod__rename"
							bind:value={renameText}
							aria-label={m['widget.todo.list_name']()}
							data-testid="todo-rename-input"
							onblur={() => void commitRename(list.id)}
							onkeydown={(event) => {
								if (event.key === 'Enter') void commitRename(list.id);
								if (event.key === 'Escape') renaming = null;
							}}
						/>
					{:else}
						<button
							type="button"
							class="tp-todod__list"
							title={m['widget.todo.rename']()}
							data-testid="todo-list"
							onclick={() => (selectedId = list.id)}
							ondblclick={() => {
								renaming = list.id;
								renameText = list.name;
							}}
						>
							{list.name}
						</button>
					{/if}

					<!-- doc 07 §5's reorder, as buttons: a drag handle would work with a
					     mouse and with nothing else. -->
					<button
						type="button"
						class="tp-todod__nudge"
						disabled={index === 0}
						aria-label={m['widget.todo.move_up']()}
						data-testid="todo-move-up"
						onclick={() => void move(index, -1)}>↑</button
					>
					<button
						type="button"
						class="tp-todod__nudge"
						disabled={index === (lists ?? []).length - 1}
						aria-label={m['widget.todo.move_down']()}
						data-testid="todo-move-down"
						onclick={() => void move(index, 1)}>↓</button
					>
				</li>
			{/each}
		</ul>
	</aside>

	<section class="tp-todod__items">
		{#if selected === null}
			<p class="tp-todod__note">{m['widget.todo.choose_list']()}</p>
		{:else}
			<div class="tp-todod__actions">
				{#each TODO_FILTERS as value (value)}
					<button
						type="button"
						aria-pressed={filter === value}
						data-testid="todo-filter-{value}"
						onclick={() => (filter = value)}
					>
						{filterLabel(value)}
					</button>
				{/each}
			</div>

			<div class="tp-todod__actions">
				<button type="button" data-testid="todo-clear-done" onclick={() => void sweep()}>
					{m['widget.todo.clear_done']()}
				</button>
				<button
					type="button"
					disabled={selected.id === tileListId}
					data-testid="todo-show-on-tile"
					onclick={() => onUpdateSettings?.({ listId: selected.id })}
				>
					{selected.id === tileListId
						? m['widget.todo.on_tile']()
						: m['widget.todo.show_on_tile']()}
				</button>

				{#if confirmingDelete === selected.id}
					<button
						type="button"
						class="danger"
						data-testid="todo-delete-list-confirm"
						onclick={() => void removeList(selected.id)}
					>
						{m['widget.todo.delete_list_confirm']()}
					</button>
					<button type="button" onclick={() => (confirmingDelete = null)}>
						{m['widget.todo.cancel']()}
					</button>
				{:else}
					<button
						type="button"
						class="danger"
						data-testid="todo-delete-list"
						onclick={() => (confirmingDelete = selected.id)}
					>
						{m['widget.todo.delete_list']()}
					</button>
				{/if}
			</div>

			<form
				class="tp-todod__add"
				onsubmit={(event) => {
					event.preventDefault();
					void add();
				}}
			>
				<input
					bind:value={text}
					placeholder={m['widget.todo.add']()}
					aria-label={m['widget.todo.add']()}
					data-testid="todo-detail-input"
				/>
				<input
					type="date"
					bind:value={due}
					aria-label={m['widget.todo.due']()}
					data-testid="todo-detail-due"
				/>
				<button type="submit" data-testid="todo-detail-add">{m['widget.todo.add_action']()}</button>
			</form>

			{#if visible.length === 0}
				<p class="tp-todod__note" data-testid="todo-detail-empty">
					{m['widget.todo.no_matches']()}
				</p>
			{:else}
				<ul class="tp-todod__rows" data-testid="todo-detail-items">
					{#each visible as todo (todo.id)}
						<li data-due={dueState(todo.due)}>
							<input
								type="checkbox"
								checked={todo.done}
								aria-label={todo.text}
								data-testid="todo-detail-check"
								onchange={() => void toggle(todo)}
							/>
							<input
								class="tp-todod__text"
								class:done={todo.done}
								value={todo.text}
								aria-label={todo.text}
								data-testid="todo-detail-text"
								onblur={(event) => void editText(todo, event.currentTarget.value)}
							/>
							<input
								type="date"
								class="tp-todod__date"
								value={todo.due ?? ''}
								aria-label={m['widget.todo.due']()}
								data-testid="todo-detail-rowdue"
								onchange={(event) => void editDue(todo, event.currentTarget.value)}
							/>
							<button
								type="button"
								class="tp-todod__drop"
								aria-label={m['widget.todo.delete_item']({ text: todo.text })}
								data-testid="todo-detail-delete"
								onclick={() => void remove(todo)}
							>
								<TpIcon name="trash" size={14} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</section>
</div>

<style>
	.tp-todod {
		display: grid;
		grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
		gap: 1rem;
		min-height: 22rem;
	}

	/* doc 13 §6: full-screen sheet under 768 px, where two columns stop being
	   two columns. */
	@media (max-width: 767px) {
		.tp-todod {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.tp-todod__lists {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-right: 1px solid var(--color-ink-700);
		padding-right: 1rem;
		min-width: 0;
	}

	@media (max-width: 767px) {
		.tp-todod__lists {
			border-right: 0;
			border-bottom: 1px solid var(--color-ink-700);
			padding: 0 0 1rem;
		}
	}

	.tp-todod__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		font-weight: 500;
	}

	.tp-todod__head button {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		min-width: 36px;
		min-height: 36px;
	}

	ul {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-todod__lists li {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		border-radius: var(--radius-ctl);
	}

	.tp-todod__lists li.selected {
		background: var(--color-beacon-soft);
	}

	.tp-todod__list,
	.tp-todod__rename {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		border: 0;
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		min-height: 40px;
		padding: 0 0.5rem;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-todod__rename {
		cursor: text;
		outline: none;
	}

	.tp-todod__nudge {
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		font-size: var(--text-2xs);
		min-width: 24px;
		min-height: 40px;
	}

	.tp-todod__nudge:disabled {
		color: var(--color-ink-500);
		cursor: default;
	}

	.tp-todod__items {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.tp-todod__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.tp-todod__actions button {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 36px;
		padding: 0 0.6rem;
	}

	.tp-todod__actions button[aria-pressed='true'] {
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
	}

	.tp-todod__actions button:disabled {
		color: var(--color-ink-500);
		cursor: default;
	}

	.tp-todod__actions button.danger {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.tp-todod__add {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.tp-todod__add input,
	.tp-todod__date {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		min-height: 40px;
		padding: 0 0.5rem;
	}

	.tp-todod__add input:first-child {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.tp-todod__add button {
		border: 1px solid var(--color-beacon);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 40px;
		padding: 0 0.75rem;
	}

	.tp-todod__rows {
		max-height: 22rem;
		overflow-y: auto;
	}

	.tp-todod__rows li {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		border-bottom: 1px solid var(--color-ink-700);
		padding: 0.25rem 0;
	}

	.tp-todod__rows input[type='checkbox'] {
		accent-color: var(--color-beacon);
	}

	.tp-todod__text {
		flex: 1 1 auto;
		min-width: 0;
		border: 0;
		background: none;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		min-height: 36px;
		outline: none;
	}

	.tp-todod__text.done {
		color: var(--color-fg-dim);
		text-decoration: line-through;
	}

	.tp-todod__date {
		flex: 0 0 auto;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		min-height: 36px;
	}

	/* doc 07 §5: overdue is the warning colour, and the date itself is still
	   readable beside it — colour is never the only channel (doc 12 §4). */
	.tp-todod__rows li[data-due='overdue'] .tp-todod__date {
		color: var(--color-warn);
	}

	.tp-todod__drop {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		min-width: 36px;
		min-height: 36px;
	}

	.tp-todod__drop:hover {
		color: var(--color-danger);
	}

	.tp-todod__note {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
