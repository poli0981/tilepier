<script lang="ts">
	import { logEntry } from '$lib/core/log-buffer';
	import type { TpNote } from '$lib/core/storage/db';
	import { createDexieWriter, type TpDexieWriter } from '$lib/core/storage/dexie-writer';
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpMarkdown from '$lib/ui/TpMarkdown.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';
	import { createNote, listNotes, resolveVisible, saveNote } from './service';

	/**
	 * doc 07 §4 — the tile: one note, rendered as markdown, editable in place.
	 *
	 * States (doc 06 §3, pure-client class): `ready`; `empty` when there are no
	 * notes at all; `loading` while the first read of IndexedDB is in flight,
	 * which unlike in the clock or the timer is a state this widget genuinely
	 * reaches, because it genuinely has something to read; and `error` through
	 * the host's boundary.
	 */
	let { settings: tileSettings, size }: TpWidgetProps = $props();

	let notes = $state<TpNote[] | null>(null);
	let editing = $state(false);
	let draft = $state('');
	let writer: TpDexieWriter<{ id: string; body: string }> | null = null;

	const note = $derived(notes === null ? null : resolveVisible(notes, tileSettings['noteId']));

	/** doc 07 §4's edge case, made visible rather than silent: the note this
	 *  tile was pinned to is gone, and this is a different one. */
	const fellBack = $derived(
		typeof tileSettings['noteId'] === 'string' &&
			note !== null &&
			note.id !== tileSettings['noteId']
	);

	$effect(() => {
		// Reads the collection once per mount. Local storage, not the network —
		// doc 20 §3's "effects never fetch" is about swr() and a service layer.
		let cancelled = false;

		listNotes()
			.then((rows) => {
				if (!cancelled) notes = rows;
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				logEntry('warn', 'could not read notes', { src: 'widget', error });
				notes = [];
			});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		// doc 04 §6: a 300 ms debounce on keystroke-level edits, flushed when the
		// tab hides and on pagehide — the writer owns both of those listeners.
		writer = createDexieWriter<{ id: string; body: string }>(
			({ id, body }) => saveNote(id, body),
			(error) => logEntry('warn', 'could not save a note', { src: 'widget', error })
		);
		return () => {
			writer?.dispose();
			writer = null;
		};
	});

	const updatedLabel = $derived(
		note === null
			? ''
			: m['widget.notes.updated']({ when: fmtRelative(note.updatedAt, settings.locale) })
	);

	function beginEdit(): void {
		if (note === null) return;
		draft = note.body;
		editing = true;
	}

	function onInput(value: string): void {
		draft = value;
		if (note !== null) writer?.schedule({ id: note.id, body: value });
	}

	function endEdit(): void {
		editing = false;
		writer?.flush();
		// Re-read rather than patching in place: the stored record carries the
		// derived title and the real timestamp, and guessing at either here is
		// how the footer starts disagreeing with the database.
		void listNotes().then((rows) => (notes = rows));
	}

	async function addFirst(): Promise<void> {
		await createNote();
		notes = await listNotes();
		beginEdit();
	}
</script>

<div class="tp-notes" data-tier={size.tier}>
	{#if notes === null}
		<!-- doc 13 §7: skeleton, never a spinner. -->
		<div class="tp-notes__state" aria-busy="true" data-testid="notes-loading">
			<TpTideGauge size={32} animated level={0.4} />
		</div>
	{:else if note === null}
		<!-- doc 06 §3's `empty`: guidance plus exactly one action, in the words
		     doc 12 §8 uses for its own example of one. -->
		<div class="tp-notes__state" data-testid="notes-empty">
			<p>{m['widget.notes.empty']()}</p>
			<button type="button" class="tp-notes__action" onclick={() => void addFirst()}>
				{m['widget.notes.empty_action']()}
			</button>
		</div>
	{:else if editing}
		<!-- svelte-ignore a11y_autofocus -->
		<textarea
			class="tp-notes__editor"
			aria-label={m['widget.notes.edit']()}
			data-testid="notes-editor"
			autofocus
			value={draft}
			oninput={(event) => onInput(event.currentTarget.value)}
			onblur={endEdit}></textarea>
		<footer class="tp-notes__foot">{m['widget.notes.editing']()}</footer>
	{:else}
		<button
			type="button"
			class="tp-notes__preview"
			title={m['widget.notes.tap_to_edit']()}
			data-testid="notes-preview"
			onclick={beginEdit}
		>
			<TpMarkdown source={note.body} />
		</button>
		<footer class="tp-notes__foot">
			{#if fellBack}
				<span class="tp-notes__warn" data-testid="notes-fellback"
					>{m['widget.notes.fell_back']()}</span
				>
			{:else}
				<span data-testid="notes-updated">{updatedLabel}</span>
			{/if}
		</footer>
	{/if}
</div>

<style>
	.tp-notes {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.25rem;
		overflow: hidden;
	}

	.tp-notes__state {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-notes__state p {
		margin: 0;
	}

	.tp-notes__action {
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

	.tp-notes__editor {
		flex: 1 1 auto;
		min-height: 0;
		width: 100%;
		resize: none;
		border: 0;
		background: none;
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.5;
		outline: none;
		padding: 0;
	}

	/* A button rather than a div with a click handler, so the whole preview is
	   one keyboard-reachable target (doc 13 §8). */
	.tp-notes__preview {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		border: 0;
		background: none;
		cursor: text;
		font: inherit;
		padding: 0;
		text-align: left;
		width: 100%;
	}

	.tp-notes__foot {
		flex: 0 0 auto;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-notes__warn {
		color: var(--color-warn);
	}
</style>
