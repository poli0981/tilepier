<script lang="ts">
	import { untrack } from 'svelte';
	import { logEntry } from '$lib/core/log-buffer';
	import type { TpNote } from '$lib/core/storage/db';
	import { createDexieWriter, type TpDexieWriter } from '$lib/core/storage/dexie-writer';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpMarkdown from '$lib/ui/TpMarkdown.svelte';
	import {
		createNote,
		deleteNote,
		listNotes,
		saveNote,
		searchNotes,
		setPinned,
		titleOf
	} from './service';

	/**
	 * doc 07 §4 — the detail: a two-pane editor with a note list beside it.
	 *
	 * The list is the shared collection, not this instance's: notes live in
	 * Dexie and every notes tile reads the same table (doc 05 §3). What is
	 * per-instance is only which note the *tile* shows, which is why "show on
	 * the tile" writes to `settings` and everything else writes to the database.
	 */
	let { settings: tileSettings, onUpdateSettings }: TpDetailProps = $props();

	let notes = $state<TpNote[] | null>(null);
	let selectedId = $state<string | null>(null);
	let draft = $state('');
	let query = $state('');
	let confirmingDelete = $state<string | null>(null);
	let writer: TpDexieWriter<{ id: string; body: string }> | null = null;

	const visible = $derived(notes === null ? [] : searchNotes(notes, query));
	const selected = $derived((notes ?? []).find((note) => note.id === selectedId) ?? null);
	const tileNoteId = $derived(
		typeof tileSettings['noteId'] === 'string' ? tileSettings['noteId'] : null
	);

	/**
	 * Reloads the list from Dexie **without touching the editor**.
	 *
	 * The separation is the whole design here, and it was learned the hard way:
	 * a single `refresh()` that reloaded the list *and* reset `draft` clobbered
	 * whatever was being typed whenever it happened to still be in flight —
	 * clicking "new note" and typing immediately produced an empty textarea and
	 * an untitled row, because the reload from the click landed after the first
	 * keystrokes. Reloading and choosing what to edit are two different
	 * operations, and only `open()` below assigns `draft`.
	 *
	 * The row for the note being edited keeps the in-progress text rather than
	 * the stored body: its debounced write has not landed yet, and letting the
	 * database win would make the sidebar title jump backwards mid-keystroke.
	 */
	async function reload(): Promise<void> {
		const rows = await listNotes();
		const editing = selectedId;

		notes =
			editing === null
				? rows
				: rows.map((note) =>
						note.id === editing ? { ...note, body: draft, title: titleOf(draft) } : note
					);
	}

	/** Moves the editor onto a note. The only place `draft` is read from stored
	 *  data. `null` means there is nothing to edit. */
	function open(id: string | null): void {
		// Flush before moving: the pending write belongs to the note being left,
		// and the debounce timer does not know that.
		writer?.flush();
		confirmingDelete = null;
		selectedId = id;
		draft = (notes ?? []).find((note) => note.id === id)?.body ?? '';
	}

	$effect(() => {
		// Reads the collection once per mount (local storage, not the network).
		//
		// **Untracked, and it has to be.** `reload()` reads `selectedId` and
		// `draft`, so a tracked body would make this effect depend on both — and
		// then every keystroke would re-read the database. Same trap doc 06 §5
		// rule 7 describes for the grid's setup effect, in a different shape: an
		// effect that means "on mount" must not read anything that changes after
		// it.
		let cancelled = false;

		untrack(() => {
			reload()
				.then(() => {
					if (!cancelled) open(notes?.[0]?.id ?? null);
				})
				.catch((error: unknown) => {
					if (cancelled) return;
					logEntry('warn', 'could not read notes', { src: 'widget', error });
					notes = [];
				});
		});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		// doc 04 §6, same writer the tile uses and for the same reason.
		writer = createDexieWriter<{ id: string; body: string }>(
			({ id, body }) => saveNote(id, body),
			(error) => logEntry('warn', 'could not save a note', { src: 'widget', error })
		);
		return () => {
			writer?.dispose();
			writer = null;
		};
	});

	function onInput(value: string): void {
		draft = value;
		const id = selectedId;
		if (id === null) return;

		writer?.schedule({ id, body: value });

		// The list is updated optimistically rather than waiting for the write.
		// Its rows show *derived* titles and the search reads bodies, so a list
		// that only caught up 300 ms later would show a stale title while you
		// typed and fail to find a note you had just written the words into.
		//
		// `updatedAt` is deliberately left alone: it means "last saved", and
		// bumping it here would also reshuffle the list under the cursor.
		notes = (notes ?? []).map((note) =>
			note.id === id ? { ...note, body: value, title: titleOf(value) } : note
		);
	}

	async function addNote(): Promise<void> {
		open(selectedId); // flushes whatever was pending on the current note
		const created = await createNote();
		await reload();
		open(created.id);
	}

	async function removeNote(id: string): Promise<void> {
		writer?.flush();
		await deleteNote(id);
		confirmingDelete = null;

		// Clear the selection first so `reload()` does not try to preserve a
		// draft belonging to a note that no longer exists.
		const wasSelected = id === selectedId;
		if (wasSelected) {
			selectedId = null;
			draft = '';
		}

		await reload();
		// A panel that empties itself after a delete is one you have to click
		// your way back into.
		if (wasSelected) open(notes?.[0]?.id ?? null);
	}

	async function togglePin(note: TpNote): Promise<void> {
		await setPinned(note.id, note.pinned !== true);
		// Selection and draft are untouched: pinning reorders the list, it does
		// not change what is being edited.
		await reload();
	}

	/** doc 07 §4: the tile's note is a per-instance setting (doc 05 §2), so this
	 *  is the one action here that writes to the layout rather than to Dexie. */
	function showOnTile(id: string): void {
		onUpdateSettings?.({ noteId: id });
	}

	function titleFor(note: TpNote): string {
		return note.title.trim() === '' ? m['widget.notes.untitled']() : note.title;
	}
</script>

<div class="tp-notesd">
	<aside class="tp-notesd__list">
		<div class="tp-notesd__tools">
			<label class="tp-notesd__search">
				<TpIcon name="search" size={16} />
				<input
					type="search"
					bind:value={query}
					placeholder={m['widget.notes.search']()}
					data-testid="notes-search"
				/>
			</label>
			<button
				type="button"
				class="tp-notesd__new"
				aria-label={m['widget.notes.new']()}
				data-testid="notes-new"
				onclick={() => void addNote()}
			>
				<TpIcon name="plus" size={16} />
			</button>
		</div>

		{#if notes !== null && visible.length === 0}
			<p class="tp-notesd__note" data-testid="notes-no-matches">
				{notes.length === 0 ? m['widget.notes.empty']() : m['widget.notes.no_matches']()}
			</p>
		{/if}

		<ul>
			{#each visible as note (note.id)}
				<li class:selected={note.id === selectedId}>
					<button
						type="button"
						class="tp-notesd__row"
						data-testid="notes-row"
						onclick={() => open(note.id)}
					>
						<span class="tp-notesd__rowtitle">{titleFor(note)}</span>
						<span class="tp-notesd__rowtime">
							{fmtRelative(note.updatedAt, settings.locale)}
						</span>
					</button>
					{#if note.pinned === true}
						<TpIcon name="check" size={12} />
					{/if}
					{#if note.id === tileNoteId}
						<span class="tp-notesd__badge">{m['widget.notes.on_tile']()}</span>
					{/if}
				</li>
			{/each}
		</ul>
	</aside>

	<section class="tp-notesd__editor">
		{#if selected === null}
			<p class="tp-notesd__note">{m['widget.notes.empty']()}</p>
		{:else}
			<div class="tp-notesd__actions">
				<button type="button" onclick={() => void togglePin(selected)} data-testid="notes-pin">
					{selected.pinned === true ? m['widget.notes.unpin']() : m['widget.notes.pin']()}
				</button>
				<button
					type="button"
					disabled={selected.id === tileNoteId}
					data-testid="notes-show-on-tile"
					onclick={() => showOnTile(selected.id)}
				>
					{selected.id === tileNoteId
						? m['widget.notes.on_tile']()
						: m['widget.notes.pin_to_tile']()}
				</button>

				{#if confirmingDelete === selected.id}
					<!-- doc 07 §4: delete is confirmed. Two buttons rather than a
					     browser confirm(), which blocks the whole tab. -->
					<button
						type="button"
						class="danger"
						data-testid="notes-delete-confirm"
						onclick={() => void removeNote(selected.id)}
					>
						{m['widget.notes.delete_confirm']()}
					</button>
					<button type="button" onclick={() => (confirmingDelete = null)}>
						{m['widget.notes.delete_cancel']()}
					</button>
				{:else}
					<button
						type="button"
						class="danger"
						data-testid="notes-delete"
						onclick={() => (confirmingDelete = selected.id)}
					>
						{m['widget.notes.delete']()}
					</button>
				{/if}
			</div>

			<div class="tp-notesd__panes">
				<textarea
					aria-label={m['widget.notes.edit']()}
					data-testid="notes-detail-editor"
					value={draft}
					oninput={(event) => onInput(event.currentTarget.value)}
					onblur={() => writer?.flush()}></textarea>
				<div class="tp-notesd__preview">
					<TpMarkdown source={draft} label={m['widget.notes.preview']()} />
				</div>
			</div>
		{/if}
	</section>
</div>

<style>
	.tp-notesd {
		display: grid;
		grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
		gap: 1rem;
		min-height: 24rem;
	}

	/* doc 13 §6: the panel is a full-screen sheet under 768 px, where two
	   columns stop being two columns. */
	@media (max-width: 767px) {
		.tp-notesd {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.tp-notesd__list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-right: 1px solid var(--color-ink-700);
		padding-right: 1rem;
		min-width: 0;
	}

	@media (max-width: 767px) {
		.tp-notesd__list {
			border-right: 0;
			border-bottom: 1px solid var(--color-ink-700);
			padding: 0 0 1rem;
		}
	}

	.tp-notesd__tools {
		display: flex;
		gap: 0.375rem;
	}

	.tp-notesd__search {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		padding: 0 0.5rem;
		color: var(--color-fg-dim);
	}

	.tp-notesd__search input {
		flex: 1 1 auto;
		min-width: 0;
		border: 0;
		background: none;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		min-height: 40px;
		outline: none;
	}

	.tp-notesd__new {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		min-width: 40px;
		min-height: 40px;
	}

	ul {
		display: flex;
		max-height: 22rem;
		flex-direction: column;
		overflow: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		border-radius: var(--radius-ctl);
		color: var(--color-fg-dim);
		padding-right: 0.375rem;
	}

	li.selected {
		background: var(--color-beacon-soft);
	}

	.tp-notesd__row {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;
		border: 0;
		background: none;
		cursor: pointer;
		font: inherit;
		min-height: 44px;
		padding: 0.35rem 0.5rem;
		text-align: left;
	}

	.tp-notesd__rowtitle {
		max-width: 100%;
		overflow: hidden;
		color: var(--color-fg);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-notesd__rowtime {
		font-size: var(--text-2xs);
	}

	.tp-notesd__badge {
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		padding: 0.1rem 0.35rem;
		white-space: nowrap;
	}

	.tp-notesd__editor {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.tp-notesd__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.tp-notesd__actions button {
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

	.tp-notesd__actions button:disabled {
		color: var(--color-ink-500);
		cursor: default;
	}

	.tp-notesd__actions button.danger {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.tp-notesd__panes {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 0.75rem;
		min-height: 18rem;
	}

	@media (max-width: 767px) {
		.tp-notesd__panes {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	textarea {
		resize: none;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.5;
		outline: none;
		padding: 0.6rem;
	}

	textarea:focus-visible {
		border-color: var(--color-beacon);
	}

	.tp-notesd__preview {
		overflow: auto;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		padding: 0.6rem;
	}

	.tp-notesd__note {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
