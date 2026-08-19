<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { readLog } from '$lib/core/log-buffer';
	import { scheduler } from '$lib/core/scheduler';
	import { db } from '$lib/core/storage/db';
	import { LOCALES, switchLocale, type TpLocale } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { LOCAL_KEYS } from '$lib/shared-constants';
	import { deck } from '$lib/stores/deck.svelte';
	import { settings } from '$lib/stores/settings.svelte';

	/**
	 * doc 13 §10. A route rather than a modal, and no save button — every
	 * control writes through the store immediately, because local-first means
	 * there is nothing to submit.
	 *
	 * The panel lives here rather than in `+page.svelte` so it can be rendered
	 * in a component test without stubbing `$app/*` routing.
	 *
	 * Sections 5 (backup) and 7 (bug report) are absent rather than disabled:
	 * an empty heading is noise, and a control that has never worked is worse.
	 */

	/** doc 12 §2: the accent is user-overridable, semantic colours are not. */
	const ACCENTS = ['#46d5c8', '#7b8ff2', '#e8b750', '#57c785', '#e8705f', '#b48ce8'] as const;

	const THEMES = ['dark', 'light', 'system'] as const;
	const MOTION = ['system', 'on', 'off'] as const;

	let estimate = $state<{ usage: number; quota: number } | null>(null);
	let eraseArmed = $state(false);

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
		// doc 16 §6. The export-first offer arrives with the exporter in Week 2;
		// until then the confirm says plainly that nothing is being saved.
		for (const key of Object.values(LOCAL_KEYS)) localStorage.removeItem(key);
		await db.delete();
		location.reload();
	}
</script>

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

		<h3>{m['settings.diagnostics.log']()}</h3>
		<pre data-testid="diagnostics-log">{readLog()
				.map((entry) => `${entry.level} [${entry.src}] ${entry.msg}`)
				.join('\n')}</pre>
	</section>
{/if}

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

<style>
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
