<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { logEntry, readLog } from '$lib/core/log-buffer';
	import { scheduler } from '$lib/core/scheduler';
	import { swrCache } from '$lib/core/swr.svelte';
	import { db } from '$lib/core/storage/db';
	import {
		applyImport,
		backupFilename,
		buildBackup,
		readBackup,
		summariseImport,
		type TpBackup,
		type TpBackupTable,
		type TpImportMode,
		type TpImportSummary
	} from '$lib/core/storage/exporter';
	import { LOCALES, switchLocale, type TpLocale } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { LOCAL_KEYS } from '$lib/shared-constants';
	import { deck } from '$lib/stores/deck.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import TpBugDialog from '$lib/ui/TpBugDialog.svelte';

	/**
	 * doc 13 §10. A route rather than a modal, and no save button — every
	 * control writes through the store immediately, because local-first means
	 * there is nothing to submit.
	 *
	 * The panel lives here rather than in `+page.svelte` so it can be rendered
	 * in a component test without stubbing `$app/*` routing.
	 *
	 * Section 5 (backup) is absent rather than disabled: an empty heading is
	 * noise, and a control that has never worked is worse. It lands in Week 2,
	 * when there is data worth round-tripping.
	 */

	/** doc 12 §2: the accent is user-overridable, semantic colours are not. These
	 *  six are the offered swatches — data the user picks from, not styling, so
	 *  they are the one place a literal colour is right. tokens-audit-ignore */
	const ACCENTS = ['#46d5c8', '#7b8ff2', '#e8b750', '#57c785', '#e8705f', '#b48ce8'] as const;

	const THEMES = ['dark', 'light', 'system'] as const;
	const MOTION = ['system', 'on', 'off'] as const;

	let estimate = $state<{ usage: number; quota: number } | null>(null);
	let eraseArmed = $state(false);
	let bugOpen = $state(false);

	// doc 18 §5: the panel ships in production but stays behind the flag.
	// Read from `location`, not `page.url`: this route is prerendered, and
	// SvelteKit refuses `url.searchParams` there — a prerendered page has no
	// query string to read. `browser` is a build-time constant, so the whole
	// branch compiles out of the server bundle rather than being guarded at
	// runtime.
	const debugOn = $derived(
		settings.debug || (browser && new URLSearchParams(location.search).get('debug') === '1')
	);

	$effect(() => {
		// Reports how much of the origin's storage budget is in use (doc 05 §7).
		if (navigator.storage?.estimate === undefined) return;
		void navigator.storage.estimate().then((result) => {
			estimate = { usage: result.usage ?? 0, quota: result.quota ?? 0 };
		});
	});

	const usedPercent = $derived(
		estimate === null || estimate.quota === 0
			? null
			: Math.round((estimate.usage / estimate.quota) * 100)
	);

	function mb(bytes: number): string {
		return `${(bytes / 1_048_576).toFixed(1)} MB`;
	}

	function resetDeck(): void {
		deck.reset();
	}

	async function eraseEverything(): Promise<void> {
		// doc 16 §3.6. The export sits directly above this in the panel, and the
		// confirm copy points at it rather than implying a backup was taken.
		for (const key of Object.values(LOCAL_KEYS)) localStorage.removeItem(key);
		await db.delete();
		location.reload();
	}

	/* ─────────────────────────────────────────────────── backup (doc 05 §6) */

	/**
	 * **`$state.raw`, not `$state`, and this is load-bearing.**
	 *
	 * `$state` deep-proxies whatever it is given. A backup read from a file is
	 * then a `Proxy`, its `dexie` rows are proxies, and `bulkPut` fails with
	 * `DataCloneError: #<Object> could not be cloned` — IndexedDB structured-
	 * clones what it stores, and a Proxy is not cloneable. The import did
	 * nothing at all, and before the `try` below it did nothing *silently*.
	 * Found 2026-08-27 by journey #6.
	 *
	 * `.raw` is the right answer rather than a workaround: all three of these
	 * are snapshots that are replaced wholesale and never mutated in place, so
	 * there is nothing for a deep proxy to observe — and a backup can be
	 * megabytes, which is a lot of object to wrap for no reason.
	 */
	let pending = $state.raw<TpBackup | null>(null);
	let preview = $state.raw<TpImportSummary | null>(null);
	let outcome = $state.raw<TpImportSummary | null>(null);

	let invalid = $state(false);
	let confirmingReplace = $state(false);
	let failed = $state(false);

	/**
	 * Hands the browser a file. A blob URL rather than a data: URL — a data URL
	 * of a few megabytes of notes is a string the browser has to hold entire,
	 * and Safari caps it. The object URL is revoked on the next frame, which is
	 * after the click has been dispatched and before it can leak.
	 */
	function download(name: string, json: string): void {
		const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = name;
		anchor.click();
		requestAnimationFrame(() => URL.revokeObjectURL(url));
	}

	async function exportBackup(): Promise<void> {
		const backup = await buildBackup(
			{ schemaVersion: 1, grid: [...deck.tiles] },
			settings.snapshot
		);
		download(backupFilename(), JSON.stringify(backup, null, '	'));
	}

	async function chooseFile(file: File | undefined): Promise<void> {
		outcome = null;
		confirmingReplace = false;
		if (file === undefined) return;

		const backup = readBackup(await file.text());
		if (backup === null) {
			invalid = true;
			pending = null;
			preview = null;
			return;
		}

		// doc 05 §6's dry run: validate, then show what would change, then let
		// the user decide. Nothing has been written at this point.
		invalid = false;
		pending = backup;
		preview = await summariseImport(backup, 'merge');
	}

	/**
	 * Applies a backup, and **says so when it cannot**.
	 *
	 * The `try` is not decoration. The click handler can only call this as
	 * `void restore(...)`, so without it a rejected promise disappears entirely:
	 * the panel would sit there looking like nothing had been asked of it, on
	 * the one screen where the user is actively worried about their data. Found
	 * 2026-08-27 by journey #6, where an import after an erase failed in exactly
	 * that shape — silently.
	 */
	async function restore(mode: TpImportMode): Promise<void> {
		const backup = pending;
		if (backup === null) return;

		failed = false;
		try {
			await applyRestore(backup, mode);
		} catch (error) {
			failed = true;
			confirmingReplace = false;
			logEntry('error', 'backup restore failed', { src: 'layout', error });
		}
	}

	async function applyRestore(backup: TpBackup, mode: TpImportMode): Promise<void> {
		// doc 05 §6: "Replace all" writes an automatic pre-import export first.
		// A destructive restore that turns out to have been the wrong file is
		// the one case where a forced backup earns its interruption.
		if (mode === 'replace') {
			const safety = await buildBackup(
				{ schemaVersion: 1, grid: [...deck.tiles] },
				settings.snapshot
			);
			download(backupFilename(), JSON.stringify(safety, null, '	'));
		}

		const result = await applyImport(backup, mode);
		outcome = result.summary;
		pending = null;
		preview = null;
		confirmingReplace = false;

		if (mode !== 'replace') return;

		// Only a replace restores the deck and the settings; a merge leaves this
		// device's own arrangement and preferences alone, which is what
		// non-destructive means for the two things that are not rows.
		deck.replaceAll(result.layout.grid);
		settings.restore(result.settings);
		// doc 14 §1: a restored locale cannot be applied in place.
		location.reload();
	}

	function tableLabel(table: TpBackupTable): string {
		return m[`settings.backup.table.${table}`]();
	}
</script>

<!--
	`data-ready` marks hydration. Every control here is an onclick, which does
	nothing until the bundle attaches — true of any hydrated page, and not worth
	disabling a dozen controls over the way the consent gate was. What it is
	worth is a deterministic signal, so a test waits for the page to be live
	instead of racing it and a future keyboard-driven surface can do the same.
-->
<div class="tp-settings" data-ready={browser}>
	<h1>{m['settings.title']()}</h1>

	<section aria-labelledby="s-language">
		<h2 id="s-language">{m['settings.language.title']()}</h2>
		<div class="tp-row">
			<span>{m['settings.language.label']()}</span>
			<div class="tp-segmented" role="group" aria-labelledby="s-language">
				{#each LOCALES as locale (locale)}
					<button
						type="button"
						aria-pressed={settings.locale === locale}
						data-testid="locale-{locale}"
						onclick={() => switchLocale(locale as TpLocale)}
					>
						{locale === 'vi' ? 'Tiếng Việt' : 'English'}
					</button>
				{/each}
			</div>
		</div>
		<p class="tp-note">{m['settings.language.reload_note']()}</p>
	</section>

	<section aria-labelledby="s-appearance">
		<h2 id="s-appearance">{m['settings.appearance.title']()}</h2>

		<div class="tp-row">
			<span>{m['settings.appearance.theme']()}</span>
			<div class="tp-segmented" role="group" aria-labelledby="s-appearance">
				{#each THEMES as theme (theme)}
					<button
						type="button"
						aria-pressed={settings.theme === theme}
						data-testid="theme-{theme}"
						onclick={() => settings.patch({ theme })}
					>
						{m[`settings.appearance.theme_${theme}`]()}
					</button>
				{/each}
			</div>
		</div>

		<div class="tp-row">
			<span>{m['settings.appearance.accent']()}</span>
			<div class="tp-swatches">
				{#each ACCENTS as accent (accent)}
					<button
						type="button"
						class="tp-swatch"
						class:selected={settings.accent === accent}
						style="--swatch: {accent}"
						aria-label={accent}
						aria-pressed={settings.accent === accent}
						data-testid="accent-{accent.slice(1)}"
						onclick={() => settings.patch({ accent })}
					></button>
				{/each}
				<input
					type="color"
					value={settings.accent}
					aria-label={m['settings.appearance.accent_custom']()}
					oninput={(event) => settings.patch({ accent: event.currentTarget.value })}
				/>
			</div>
		</div>

		<div class="tp-row">
			<span>{m['settings.appearance.motion']()}</span>
			<div class="tp-segmented" role="group" aria-labelledby="s-appearance">
				{#each MOTION as value (value)}
					<button
						type="button"
						aria-pressed={settings.reducedMotion === value}
						data-testid="motion-{value}"
						onclick={() => settings.patch({ reducedMotion: value })}
					>
						{m[`settings.appearance.motion_${value}`]()}
					</button>
				{/each}
			</div>
		</div>
	</section>

	<section aria-labelledby="s-display">
		<h2 id="s-display">{m['settings.display.title']()}</h2>

		<div class="tp-row">
			<label for="clock24h">{m['settings.display.clock24h']()}</label>
			<input
				id="clock24h"
				type="checkbox"
				checked={settings.clock24h}
				data-testid="clock24h"
				onchange={(event) => settings.patch({ clock24h: event.currentTarget.checked })}
			/>
		</div>

		<div class="tp-row">
			<label for="week-start">{m['settings.display.week_start']()}</label>
			<select
				id="week-start"
				value={String(settings.weekStartsOn)}
				data-testid="week-start"
				onchange={(event) =>
					settings.patch({ weekStartsOn: event.currentTarget.value === '1' ? 1 : 0 })}
			>
				<option value="1">{m['settings.display.week_monday']()}</option>
				<option value="0">{m['settings.display.week_sunday']()}</option>
			</select>
		</div>
	</section>

	<section aria-labelledby="s-deck">
		<h2 id="s-deck">{m['settings.deck.title']()}</h2>
		<div class="tp-row">
			<span>{m['settings.deck.reset']()}</span>
			<button type="button" class="tp-action" data-testid="reset-deck" onclick={resetDeck}>
				{m['settings.deck.reset_action']()}
			</button>
		</div>
		<p class="tp-note">{m['settings.deck.reset_note']()}</p>
	</section>

	<!--
		doc 13 §10 section 5. It was omitted entirely until now rather than shown
		disabled — an empty heading is noise, and a control that has never worked
		is worse. It sits above Storage so that the erase confirm below can point
		at it (doc 16 §3.6).
	-->
	<section aria-labelledby="s-backup">
		<h2 id="s-backup">{m['settings.backup.title']()}</h2>

		<div class="tp-row">
			<span>{m['settings.backup.export']()}</span>
			<button
				type="button"
				class="tp-action"
				data-testid="backup-export"
				onclick={() => void exportBackup()}
			>
				{m['settings.backup.export_action']()}
			</button>
		</div>
		<p class="tp-note">{m['settings.backup.export_note']()}</p>

		<div class="tp-row">
			<span>{m['settings.backup.import']()}</span>
			<label class="tp-action tp-file">
				{m['settings.backup.import_action']()}
				<input
					type="file"
					accept="application/json,.json"
					data-testid="backup-file"
					onchange={(event) => void chooseFile(event.currentTarget.files?.[0])}
				/>
			</label>
		</div>

		{#if invalid}
			<p class="tp-warn" role="alert" data-testid="backup-invalid">
				{m['settings.backup.invalid']()}
			</p>
		{/if}

		{#if preview !== null}
			<!-- doc 05 §6's diff summary: counts per table, before anything is
			     written, and the two ways forward side by side. -->
			<div class="tp-review" data-testid="backup-review">
				<h3>{m['settings.backup.review']()}</h3>
				<ul class="tp-counts">
					{#each preview.tables.filter((row) => row.incoming > 0) as row (row.table)}
						<li class="tp-num">
							{m['settings.backup.row']({
								table: tableLabel(row.table),
								added: row.added,
								updated: row.updated
							})}
						</li>
					{/each}
				</ul>

				<div class="tp-confirm">
					<button
						type="button"
						class="tp-action"
						data-testid="backup-merge"
						onclick={() => void restore('merge')}
					>
						{m['settings.backup.merge_action']()}
					</button>

					{#if confirmingReplace}
						<button
							type="button"
							class="tp-action tp-action--danger"
							data-testid="backup-replace-confirm"
							onclick={() => void restore('replace')}
						>
							{m['settings.backup.replace_confirm']()}
						</button>
					{:else}
						<button
							type="button"
							class="tp-action tp-action--danger"
							data-testid="backup-replace"
							onclick={() => (confirmingReplace = true)}
						>
							{m['settings.backup.replace_action']()}
						</button>
					{/if}

					<button
						type="button"
						class="tp-action"
						data-testid="backup-cancel"
						onclick={() => {
							pending = null;
							preview = null;
							confirmingReplace = false;
						}}
					>
						{m['settings.backup.cancel']()}
					</button>
				</div>

				<p class="tp-note">{m['settings.backup.merge_note']()}</p>
				<p class="tp-note">{m['settings.backup.replace_note']()}</p>
			</div>
		{/if}

		{#if failed}
			<p class="tp-warn" role="alert" data-testid="backup-failed">
				{m['settings.backup.failed']()}
			</p>
		{/if}

		{#if outcome !== null}
			<p class="tp-note" role="status" data-testid="backup-done">
				{m['settings.backup.done']({ added: outcome.added, updated: outcome.updated })}
			</p>
		{/if}
	</section>

	<section aria-labelledby="s-storage">
		<h2 id="s-storage">{m['settings.storage.title']()}</h2>

		<div class="tp-row">
			<span>{m['settings.storage.used']()}</span>
			<span class="tp-num" data-testid="storage-estimate">
				{#if estimate === null}
					—
				{:else}
					{mb(estimate.usage)} / {mb(estimate.quota)}
				{/if}
			</span>
		</div>

		{#if usedPercent !== null && usedPercent > 80}
			<!-- doc 05 §7: warn past 80 %, before an import is the thing that fails. -->
			<p class="tp-warn" role="status">
				{m['settings.storage.nearly_full']({ percent: usedPercent })}
			</p>
		{/if}

		<div class="tp-row">
			<span>{m['settings.storage.erase']()}</span>
			{#if eraseArmed}
				<span class="tp-confirm">
					<button
						type="button"
						class="tp-action tp-action--danger"
						data-testid="erase-confirm"
						onclick={eraseEverything}
					>
						{m['settings.storage.erase_confirm']()}
					</button>
					<button type="button" class="tp-action" onclick={() => (eraseArmed = false)}>
						{m['settings.storage.erase_cancel']()}
					</button>
				</span>
			{:else}
				<button
					type="button"
					class="tp-action tp-action--danger"
					data-testid="erase-data"
					onclick={() => (eraseArmed = true)}
				>
					{m['settings.storage.erase_action']()}
				</button>
			{/if}
		</div>
		<p class="tp-note">{m['settings.storage.erase_note']()}</p>
	</section>

	{#if debugOn}
		<section aria-labelledby="s-diagnostics" data-testid="diagnostics">
			<h2 id="s-diagnostics">{m['settings.diagnostics.title']()}</h2>

			<h3>{m['settings.diagnostics.scheduler']()}</h3>
			{#if scheduler.inspect().length === 0}
				<p class="tp-note">{m['settings.diagnostics.no_tasks']()}</p>
			{:else}
				<div class="tp-scroll">
					<table>
						<tbody>
							{#each scheduler.inspect() as task (task.id)}
								<tr>
									<td>{task.label}</td>
									<td>{task.state}</td>
									<td class="tp-num">{task.consecutiveFailures}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<!--
				doc 13 §10 §8: the swr cache ages, which arrive with their module in
				Week 3. Nothing on the deck is networked yet, so this table is
				normally empty — and that is the honest thing for it to say rather
				than being left out until it can be full.
			-->
			<h3>{m['settings.diagnostics.swr']()}</h3>
			{#if swrCache.inspect().length === 0}
				<p class="tp-note">{m['settings.diagnostics.no_cache']()}</p>
			{:else}
				<div class="tp-scroll">
					<table>
						<tbody>
							{#each swrCache.inspect() as row (row.key)}
								<tr>
									<td>{row.key}</td>
									<td>{row.status}</td>
									<td class="tp-num">{row.ageMs === null ? '—' : Math.round(row.ageMs / 1000)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<h3>{m['settings.diagnostics.log']()}</h3>
			<pre data-testid="diagnostics-log">{readLog()
					.map((entry) => `${entry.level} [${entry.src}] ${entry.msg}`)
					.join('\n')}</pre>
		</section>
	{/if}

	<section aria-labelledby="s-report">
		<h2 id="s-report">{m['settings.report.title']()}</h2>
		<div class="tp-row">
			<span>{m['settings.report.label']()}</span>
			<button
				type="button"
				class="tp-action"
				data-testid="open-bug"
				onclick={() => (bugOpen = true)}
			>
				{m['settings.report.open']()}
			</button>
		</div>
		<p class="tp-note">{m['settings.report.note']()}</p>
	</section>

	<TpBugDialog open={bugOpen} onClose={() => (bugOpen = false)} />

	<section aria-labelledby="s-about">
		<h2 id="s-about">{m['settings.about.title']()}</h2>
		<p class="tp-num tp-build" data-testid="build-info">
			{m['about.build']({ version: __TP_BUILD__.version, sha: __TP_BUILD__.sha })}
		</p>
		<p class="tp-links">
			<a href={resolve('/about')}>{m['about.title']()}</a>
			<a href={resolve('/legal/terms')}>{m['legal.terms.title']()}</a>
			<a href={resolve('/legal/privacy')}>{m['legal.privacy.title']()}</a>
			<a href={resolve('/legal/licenses')}>{m['legal.licenses.title']()}</a>
		</p>
	</section>
</div>

<style>
	.tp-settings {
		display: contents;
	}

	h1 {
		margin: 0 0 1.5rem;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	h2 {
		margin: 2rem 0 0.5rem;
		font-size: var(--text-base);
		font-weight: 600;
	}

	h3 {
		margin: 1rem 0 0.25rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		font-weight: 500;
	}

	.tp-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--color-ink-700);
		padding: 0.625rem 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		flex-wrap: wrap;
	}

	.tp-note {
		margin: 0.5rem 0 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-warn {
		margin: 0.5rem 0 0;
		color: var(--color-warn);
		font-size: var(--text-2xs);
	}

	.tp-segmented {
		display: flex;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		overflow: hidden;
	}

	.tp-segmented button {
		border: 0;
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 40px;
		padding: 0 0.75rem;
	}

	.tp-segmented button[aria-pressed='true'] {
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
	}

	.tp-swatches {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tp-swatch {
		width: 24px;
		height: 24px;
		border: 2px solid transparent;
		border-radius: 50%;
		background: var(--swatch);
		cursor: pointer;
		padding: 0;
	}

	.tp-swatch.selected {
		border-color: var(--color-fg);
	}

	.tp-swatches input[type='color'] {
		width: 28px;
		height: 28px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		padding: 2px;
	}

	.tp-action {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 36px;
		padding: 0 0.75rem;
	}

	.tp-action--danger {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.tp-confirm {
		display: flex;
		gap: 0.375rem;
	}

	.tp-links {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin: 0.5rem 0 0;
	}

	.tp-links a {
		color: var(--color-beacon);
		font-size: var(--text-xs);
	}

	.tp-build {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	/* A styled label wrapping a hidden input: the native file button cannot be
	   restyled, and a bare one beside the panel's own controls looks like a
	   piece of a different application. */
	.tp-file {
		display: inline-flex;
		align-items: center;
		cursor: pointer;
	}

	.tp-file input {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.tp-file:focus-within {
		border-color: var(--color-beacon);
	}

	.tp-review {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		padding: 0.75rem;
		margin-top: 0.5rem;
	}

	.tp-review h3 {
		margin: 0 0 0.5rem;
	}

	.tp-counts {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin: 0 0 0.75rem;
		padding: 0;
		list-style: none;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-2xs);
		color: var(--color-fg-mute);
	}

	td {
		border-bottom: 1px solid var(--color-ink-700);
		padding: 0.25rem 0.5rem 0.25rem 0;
	}

	pre {
		max-height: 16rem;
		overflow: auto;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		padding: 0.5rem;
		color: var(--color-fg-mute);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		white-space: pre-wrap;
	}
</style>
