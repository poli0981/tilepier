<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { collection } from './collection.svelte';
	import { supportsFsa } from './library';

	/**
	 * How music gets into the library (doc 09 §2), for the tile's empty state and
	 * the detail alike: choose a folder where the browser can keep one (path A),
	 * add files everywhere (path B), and — where there is no folder access — add
	 * a folder's files through the input instead.
	 *
	 * The notes are part of the job, not decoration: the files never leave the
	 * device, and on path B they are copied into this browser, where Safari
	 * deletes them after a week without a visit (doc 22 §S7).
	 */
	interface Props {
		/** The tile's version: no rescan, no counts. */
		compact?: boolean;
		/** The privacy line — dropped only where the tile has no room for it. */
		showNote?: boolean;
	}

	let { compact = false, showNote = true }: Props = $props();

	const fsa = supportsFsa();
	const AUDIO_ACCEPT = 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav';

	function onFiles(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		// Cleared, so choosing the same files again is still a change.
		input.value = '';
		void collection.importFiles(files);
	}
</script>

<div class="tp-mlib" class:tp-mlib--compact={compact}>
	{#if collection.scanning !== null}
		<p class="tp-mlib__line" role="status" data-testid="music-scanning">
			<span class="tp-num">
				{collection.scanning.total === 0
					? m['widget.music.scanning_start']()
					: m['widget.music.scanning']({
							done: collection.scanning.done,
							total: collection.scanning.total
						})}
			</span>
			<button type="button" class="tp-mlib__link" onclick={() => collection.cancelScan()}>
				{m['widget.music.cancel']()}
			</button>
		</p>
	{:else if collection.pendingImport !== null}
		<p class="tp-mlib__line" role="alert" data-testid="music-quota-warning">
			<span>{m['widget.music.quota_warning']()}</span>
			<button type="button" class="tp-mlib__link" onclick={() => void collection.confirmImport()}>
				{m['widget.music.import_anyway']()}
			</button>
			<button type="button" class="tp-mlib__link" onclick={() => collection.dismissImport()}>
				{m['common.dismiss']()}
			</button>
		</p>
	{:else}
		<div class="tp-mlib__actions">
			{#if fsa}
				<button
					type="button"
					class="tp-mlib__action"
					onclick={() => void collection.pickFolder()}
					data-testid="music-pick"
				>
					<TpIcon name="folder" size={15} />
					{collection.folder === 'none'
						? m['widget.music.pick_folder']()
						: m['widget.music.change_folder']()}
				</button>
				{#if !compact && collection.folder === 'granted'}
					<button
						type="button"
						class="tp-mlib__action"
						onclick={() => void collection.rescan()}
						data-testid="music-rescan"
					>
						<TpIcon name="refresh" size={15} />
						{m['widget.music.rescan']()}
					</button>
				{/if}
			{/if}
			<label class="tp-mlib__action">
				<input
					class="tp-mlib__file"
					type="file"
					multiple
					accept={AUDIO_ACCEPT}
					onchange={onFiles}
					data-testid="music-add-files"
				/>
				<TpIcon name="upload" size={15} />
				{m['widget.music.add_files']()}
			</label>
			{#if !fsa}
				<label class="tp-mlib__action">
					<input
						class="tp-mlib__file"
						type="file"
						webkitdirectory
						onchange={onFiles}
						data-testid="music-add-folder"
					/>
					<TpIcon name="folder" size={15} />
					{m['widget.music.add_folder']()}
				</label>
			{/if}
		</div>
	{/if}

	{#if !compact && collection.scanning === null}
		{#if collection.scanFailed}
			<p class="tp-mlib__line tp-mlib__line--warn" role="alert">
				{m['widget.music.scan_failed']()}
			</p>
		{:else if collection.summary?.quotaExceeded}
			<p class="tp-mlib__line tp-mlib__line--warn" role="alert">
				{m['widget.music.quota_full']({ added: collection.summary.added })}
			</p>
		{:else if collection.summary !== null}
			<p class="tp-mlib__line tp-num" data-testid="music-summary">
				{m['widget.music.summary']({
					added: collection.summary.added,
					updated: collection.summary.updated,
					missing: collection.summary.missing
				})}
			</p>
		{/if}
	{/if}

	{#if showNote}
		<p class="tp-mlib__note">
			{m['widget.music.local_note']()}
			{#if !fsa}
				{m['widget.music.import_note']()}
				{m['widget.music.safari_note']()}
			{/if}
		</p>
	{/if}
</div>

<style>
	.tp-mlib {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tp-mlib__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.tp-mlib__action {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 36px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0 0.625rem;
	}

	.tp-mlib__action:hover {
		border-color: var(--color-beacon);
	}

	.tp-mlib__action:focus-within,
	.tp-mlib__action:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	/* Visually hidden, still focusable through its label. */
	.tp-mlib__file {
		position: absolute;
		overflow: hidden;
		width: 1px;
		height: 1px;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.tp-mlib__line {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-mlib__line--warn {
		color: var(--color-warn);
	}

	.tp-mlib__link {
		border: 0;
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		padding: 0.25rem 0;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.tp-mlib__note {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		line-height: 1.45;
	}
</style>
