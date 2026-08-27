<script lang="ts">
	import { logEntry } from '$lib/core/log-buffer';
	import type { TpTodo, TpTodoList } from '$lib/core/storage/db';
	import type { TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';
	import {
		countDone,
		createTodo,
		dueState,
		listLists,
		listTodos,
		resolveList,
		setDone,
		sortTodos
	} from './service';

	/**
	 * doc 07 §5 — the tile: one list, an add field on top, unchecked items
	 * first, and the completed ones collapsed under "done (n)".
	 *
	 * Read, check and add only. Editing text, changing due dates, reordering
	 * lists and clearing the done group all belong to the detail — that
	 * section says so, and a tile that could do everything would need to be
	 * the size of one.
	 *
	 * States (doc 06 §3, pure-client class): `loading` while Dexie is read,
	 * `empty` in two distinct shapes — no lists at all, or a list with nothing
	 * on it — `ready`, and `error` through the host's boundary.
	 */
	let { settings: tileSettings, size, onUpdateSettings }: TpWidgetProps = $props();

	let lists = $state<TpTodoList[] | null>(null);
	let todos = $state<TpTodo[]>([]);
	let text = $state('');

	const list = $derived(lists === null ? null : resolveList(lists, tileSettings['listId']));

	/** doc 07 §5's edge case: the tile points at a list that has been deleted.
	 *  Distinct from "there are no lists" — the user had one and it went. */
	const listGone = $derived(
		lists !== null &&
			lists.length > 0 &&
			typeof tileSettings['listId'] === 'string' &&
			list === null
	);

	const ordered = $derived(sortTodos(todos));
	const open = $derived(ordered.filter((todo) => !todo.done));
	const done = $derived(ordered.filter((todo) => todo.done));

	$effect(() => {
		// Reads the lists once per mount (local storage, not the network).
		let cancelled = false;

		listLists()
			.then((rows) => {
				if (!cancelled) lists = rows;
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				logEntry('warn', 'could not read todo lists', { src: 'widget', error });
				lists = [];
			});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		// Reads the items of whichever list is shown, and re-reads when it
		// changes. Depends on the id alone, deliberately: depending on the list
		// *object* would re-read on every unrelated rename.
		const id = list?.id;
		if (id === undefined) {
			todos = [];
			return;
		}

		let cancelled = false;
		listTodos(id)
			.then((rows) => {
				if (!cancelled) todos = rows;
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				logEntry('warn', 'could not read todos', { src: 'widget', error });
				todos = [];
			});

		return () => {
			cancelled = true;
		};
	});

	async function add(): Promise<void> {
		if (list === null) return;
		const created = await createTodo(list.id, text);
		if (created === null) return;

		text = '';
		todos = [...todos, created];
	}

	async function toggle(todo: TpTodo): Promise<void> {
		const next = !todo.done;
		// Optimistic: a checkbox that waits for IndexedDB before it moves feels
		// broken, and the write cannot meaningfully fail here.
		todos = todos.map((entry) =>
			entry.id === todo.id ? { ...entry, done: next, updatedAt: Date.now() } : entry
		);
		await setDone(todo.id, next);
	}

	function chip(todo: TpTodo): { label: string; state: string } | null {
		const state = dueState(todo.due);
		if (state === 'none' || todo.due === undefined) return null;

		if (state === 'overdue') return { label: m['widget.todo.overdue'](), state };
		if (state === 'today') return { label: m['widget.todo.today'](), state };
		// An upcoming date is shown as the date itself: "in 3 days" is less
		// useful than "30/08" when you are deciding what to do first.
		return { label: todo.due.slice(5).replace('-', '/'), state };
	}
</script>

<div class="tp-todo" data-tier={size.tier}>
	{#if lists === null}
		<!-- doc 13 §7: skeleton, never a spinner. -->
		<div class="tp-todo__state" aria-busy="true" data-testid="todo-loading">
			<TpTideGauge size={32} animated level={0.4} />
		</div>
	{:else if listGone}
		<div class="tp-todo__state" data-testid="todo-gone">
			<p class="tp-todo__warn">{m['widget.todo.gone']()}</p>
			<button
				type="button"
				class="tp-todo__action"
				onclick={() => onUpdateSettings?.({ listId: undefined })}
			>
				{m['widget.todo.choose_list']()}
			</button>
		</div>
	{:else if list === null}
		<!-- doc 06 §3's `empty`: guidance plus exactly one action. -->
		<div class="tp-todo__state" data-testid="todo-no-lists">
			<p>{m['widget.todo.no_lists']()}</p>
			<button
				type="button"
				class="tp-todo__action"
				data-testid="todo-first-list"
				onclick={() => onUpdateSettings?.({ listId: undefined })}
			>
				{m['widget.todo.no_lists_action']()}
			</button>
		</div>
	{:else}
		<form
			class="tp-todo__add"
			onsubmit={(event) => {
				event.preventDefault();
				void add();
			}}
		>
			<input
				bind:value={text}
				placeholder={m['widget.todo.add']()}
				aria-label={m['widget.todo.add']()}
				data-testid="todo-input"
			/>
			<button type="submit" aria-label={m['widget.todo.add_action']()} data-testid="todo-add">
				<TpIcon name="plus" size={14} />
			</button>
		</form>

		{#if ordered.length === 0}
			<p class="tp-todo__note" data-testid="todo-empty">{m['widget.todo.empty']()}</p>
		{:else}
			<ul class="tp-todo__items" data-testid="todo-items">
				{#each open as todo (todo.id)}
					<li>
						<label>
							<input
								type="checkbox"
								checked={todo.done}
								data-testid="todo-check"
								onchange={() => void toggle(todo)}
							/>
							<span class="tp-todo__text">{todo.text}</span>
						</label>
						{#if chip(todo) !== null}
							{@const due = chip(todo)}
							<span class="tp-todo__chip tp-num" data-due={due?.state}>{due?.label}</span>
						{/if}
					</li>
				{/each}
			</ul>

			{#if done.length > 0}
				<!-- doc 07 §5: the completed ones collapse under a count. -->
				<details class="tp-todo__done" data-testid="todo-done-group">
					<summary>{m['widget.todo.done_group']({ count: countDone(ordered) })}</summary>
					<ul class="tp-todo__items">
						{#each done as todo (todo.id)}
							<li>
								<label>
									<input
										type="checkbox"
										checked={todo.done}
										data-testid="todo-check-done"
										onchange={() => void toggle(todo)}
									/>
									<span class="tp-todo__text tp-todo__text--done">{todo.text}</span>
								</label>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.tp-todo {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.375rem;
		overflow: hidden;
	}

	.tp-todo__state {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-todo__state p {
		margin: 0;
	}

	.tp-todo__warn {
		color: var(--color-warn);
	}

	.tp-todo__action {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 36px;
		padding: 0 0.75rem;
	}

	.tp-todo__add {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-ink-700);
		padding-bottom: 0.25rem;
	}

	.tp-todo__add input {
		flex: 1 1 auto;
		min-width: 0;
		border: 0;
		background: none;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		min-height: 32px;
		outline: none;
	}

	.tp-todo__add button {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		min-width: 32px;
		min-height: 32px;
	}

	.tp-todo__items {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-todo__items li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 28px;
	}

	.tp-todo__items label {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}

	.tp-todo__items input[type='checkbox'] {
		accent-color: var(--color-beacon);
		flex: 0 0 auto;
	}

	.tp-todo__text {
		overflow: hidden;
		color: var(--color-fg);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-todo__text--done {
		color: var(--color-fg-dim);
		text-decoration: line-through;
	}

	.tp-todo__chip {
		flex: 0 0 auto;
		border-radius: var(--radius-ctl);
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		padding: 0.05rem 0.35rem;
	}

	/* doc 07 §5: overdue takes the warning colour. Colour is never the only
	   channel — the word "overdue" is the label itself (doc 12 §4). */
	.tp-todo__chip[data-due='overdue'] {
		background: color-mix(in oklch, var(--color-warn) 16%, transparent);
		color: var(--color-warn);
	}

	.tp-todo__chip[data-due='today'] {
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
	}

	.tp-todo__items,
	.tp-todo__done {
		overflow-y: auto;
		min-height: 0;
	}

	.tp-todo__done summary {
		color: var(--color-fg-dim);
		cursor: pointer;
		font-size: var(--text-2xs);
		padding: 0.25rem 0;
	}

	.tp-todo__note {
		margin: 0.5rem 0 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
