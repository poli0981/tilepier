<script lang="ts">
	import { logEntry } from '$lib/core/log-buffer';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtDate } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings as appSettings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { notifyPermission, requestNotifyPermission } from './alert';
	import {
		HISTORY_DAYS,
		focusHistory,
		formatRemaining,
		readSettings,
		resetCycle,
		type TpFocusDay
	} from './service';
	import { MAX_DURATION_MS, MAX_PRESETS, MIN_DURATION_MS, type TpTimerMode } from './types';

	/**
	 * doc 07 §2 — the detail: pomodoro configuration, the editable countdown
	 * presets, and fourteen days of focus minutes as an inline SVG bar
	 * sparkline.
	 *
	 * **No chart library.** doc 20 §6 originally listed `timer` among the
	 * ECharts detail chunks and was corrected on 2026-08-10 for this reason:
	 * fourteen rectangles do not justify 180 KB, and the budget table now puts
	 * this chunk under the ordinary per-widget row.
	 */
	let { settings: tileSettings, onUpdateSettings }: TpDetailProps = $props();

	const timer = $derived(readSettings(tileSettings));

	let history = $state<TpFocusDay[] | null>(null);
	let permission = $state(notifyPermission());

	$effect(() => {
		// Reads the focus history out of IndexedDB. Not the "effects never fetch"
		// case doc 20 §3 forbids — that rule is about the network, which goes
		// through swr() and a service. This is local storage, it cannot fail
		// slowly, and there is nothing to cache it in front of.
		let cancelled = false;

		focusHistory()
			.then((days) => {
				if (!cancelled) history = days;
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				logEntry('warn', 'could not read the focus history', { src: 'widget', error });
				history = [];
			});

		return () => {
			cancelled = true;
		};
	});

	const totalMs = $derived((history ?? []).reduce((sum, day) => sum + day.focusMs, 0));
	const peakMs = $derived(Math.max(1, ...(history ?? []).map((day) => day.focusMs)));

	function minutes(ms: number): number {
		return Math.round(ms / 60_000);
	}

	function setMinutes(
		key: 'durationMs' | 'focusMs' | 'breakMs' | 'longBreakMs',
		value: string
	): void {
		const asMs = Number(value) * 60_000;
		if (!Number.isFinite(asMs)) return;
		onUpdateSettings?.({
			[key]: Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, asMs))
		});
	}

	function setMode(mode: TpTimerMode): void {
		// Switching mode stops whatever was running: the phase about to be shown
		// is a different length, and a deadline from the old one would read as a
		// nonsensical fraction of it.
		onUpdateSettings?.({ mode, endsAt: null, pausedMs: null });
	}

	function usePreset(ms: number): void {
		onUpdateSettings?.({ durationMs: ms, endsAt: null, pausedMs: null });
	}

	function addPreset(): void {
		if (timer.presets.includes(timer.durationMs) || timer.presets.length >= MAX_PRESETS) return;
		onUpdateSettings?.({ presets: [...timer.presets, timer.durationMs].sort((a, b) => a - b) });
	}

	function removePreset(ms: number): void {
		onUpdateSettings?.({ presets: timer.presets.filter((entry) => entry !== ms) });
	}

	async function toggleNotify(wanted: boolean): Promise<void> {
		if (!wanted) {
			onUpdateSettings?.({ notify: false });
			return;
		}
		// doc 07 §2: permission is asked for on the user's action, not on load.
		permission = await requestNotifyPermission();
		onUpdateSettings?.({ notify: permission === 'granted' });
	}

	/** `Fri 15/08` for the bar's tooltip and its accessible label. */
	function dayLabel(dateKey: string): string {
		// The key is local-midnight-anchored; parsing the parts avoids the UTC
		// interpretation `new Date('2026-08-27')` would give it.
		const [year, month, day] = dateKey.split('-').map(Number);
		return fmtDate(new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1), appSettings.locale);
	}
</script>

<div class="tp-timerd">
	<section>
		<h3>{m['widget.timer.durations']()}</h3>
		<div class="tp-timerd__modes" role="group">
			{#each ['countdown', 'pomodoro'] as const as mode (mode)}
				<button
					type="button"
					aria-pressed={timer.mode === mode}
					data-testid="timer-mode-{mode}"
					onclick={() => setMode(mode)}
				>
					{mode === 'countdown'
						? m['widget.timer.mode.countdown']()
						: m['widget.timer.mode.pomodoro']()}
				</button>
			{/each}
		</div>

		{#if timer.mode === 'countdown'}
			<label class="tp-timerd__row">
				<span>{m['widget.timer.duration']()}</span>
				<span class="tp-timerd__num">
					<input
						type="number"
						min={minutes(MIN_DURATION_MS)}
						max={minutes(MAX_DURATION_MS)}
						value={minutes(timer.durationMs)}
						data-testid="timer-duration"
						onchange={(event) => setMinutes('durationMs', event.currentTarget.value)}
					/>
					{m['widget.timer.settings.minutes']()}
				</span>
			</label>

			<div class="tp-timerd__row">
				<span>{m['widget.timer.presets']()}</span>
				<span class="tp-timerd__presets">
					{#each timer.presets as preset (preset)}
						<span class="tp-timerd__preset">
							<button type="button" class="tp-num" onclick={() => usePreset(preset)}>
								{formatRemaining(preset)}
							</button>
							<button
								type="button"
								class="tp-timerd__drop"
								aria-label={m['widget.timer.preset_remove']({
									duration: formatRemaining(preset)
								})}
								onclick={() => removePreset(preset)}
							>
								<TpIcon name="close" size={12} />
							</button>
						</span>
					{/each}
					<button
						type="button"
						class="tp-timerd__addpreset"
						disabled={timer.presets.length >= MAX_PRESETS ||
							timer.presets.includes(timer.durationMs)}
						data-testid="timer-add-preset"
						onclick={addPreset}
					>
						<TpIcon name="plus" size={12} />
					</button>
				</span>
			</div>
		{:else}
			{#each [['focusMs', m['widget.timer.settings.focus']()], ['breakMs', m['widget.timer.settings.break']()], ['longBreakMs', m['widget.timer.settings.long_break']()]] as const as [key, label] (key)}
				<label class="tp-timerd__row">
					<span>{label}</span>
					<span class="tp-timerd__num">
						<input
							type="number"
							min={minutes(MIN_DURATION_MS)}
							max={minutes(MAX_DURATION_MS)}
							value={minutes(timer[key])}
							data-testid="timer-{key}"
							onchange={(event) => setMinutes(key, event.currentTarget.value)}
						/>
						{m['widget.timer.settings.minutes']()}
					</span>
				</label>
			{/each}

			<label class="tp-timerd__row">
				<span>{m['widget.timer.settings.cycle']()}</span>
				<span class="tp-timerd__num">
					<input
						type="number"
						min="2"
						max="12"
						value={timer.cycleLength}
						data-testid="timer-cycle"
						onchange={(event) =>
							onUpdateSettings?.({ cycleLength: Number(event.currentTarget.value) })}
					/>
				</span>
			</label>

			<div class="tp-timerd__row">
				<span>{m['widget.timer.reset']()}</span>
				<button
					type="button"
					class="tp-timerd__action"
					data-testid="timer-reset-cycle"
					onclick={() => onUpdateSettings?.(resetCycle())}
				>
					{m['widget.timer.reset']()}
				</button>
			</div>
		{/if}
	</section>

	<section>
		<h3>{m['widget.timer.history']()}</h3>

		{#if history === null}
			<div class="tp-timerd__bars" aria-hidden="true">
				{#each { length: HISTORY_DAYS } as _, index (index)}
					<span class="tp-timerd__bar tp-timerd__bar--idle"></span>
				{/each}
			</div>
		{:else if totalMs === 0}
			<p class="tp-timerd__note" data-testid="timer-history-empty">
				{m['widget.timer.history_empty']()}
			</p>
		{:else}
			<!--
				Fourteen rectangles, one per day, empty days included — a sparkline
				with gaps lies about its own axis. Bars rather than a path because
				each one is a discrete total, and each carries its own label so the
				chart has the accessible summary doc 13 §8 asks of every chart.
			-->
			<div class="tp-timerd__bars" role="list" data-testid="timer-history">
				{#each history as day (day.dateKey)}
					<span
						role="listitem"
						class="tp-timerd__bar"
						class:empty={day.focusMs === 0}
						style="--h: {Math.max(4, Math.round((day.focusMs / peakMs) * 100))}%"
						title={m['widget.timer.history_day']({
							date: dayLabel(day.dateKey),
							minutes: minutes(day.focusMs)
						})}
						aria-label={m['widget.timer.history_day']({
							date: dayLabel(day.dateKey),
							minutes: minutes(day.focusMs)
						})}
					></span>
				{/each}
			</div>
			<p class="tp-timerd__note tp-num">
				{m['widget.timer.history_total']({ minutes: minutes(totalMs) })}
			</p>
		{/if}
	</section>

	<section class="tp-timerd__prefs">
		<label>
			<input
				type="checkbox"
				checked={timer.muted}
				data-testid="timer-mute"
				onchange={(event) => onUpdateSettings?.({ muted: event.currentTarget.checked })}
			/>
			{m['widget.timer.settings.mute']()}
		</label>
		<label>
			<input
				type="checkbox"
				checked={timer.notify}
				data-testid="timer-notify"
				onchange={(event) => void toggleNotify(event.currentTarget.checked)}
			/>
			{m['widget.timer.settings.notify']()}
		</label>
		{#if permission === 'denied'}
			<p class="tp-timerd__note" data-testid="timer-permission-note">
				{m['widget.timer.permission_blocked']()}
			</p>
		{/if}
	</section>
</div>

<style>
	.tp-timerd {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	h3 {
		margin: 0 0 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		font-weight: 500;
	}

	.tp-timerd__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--color-ink-700);
		padding: 0.5rem 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		flex-wrap: wrap;
	}

	.tp-timerd__modes {
		display: flex;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		overflow: hidden;
		margin-bottom: 0.5rem;
		width: fit-content;
	}

	.tp-timerd__modes button {
		border: 0;
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 40px;
		padding: 0 0.75rem;
	}

	.tp-timerd__modes button[aria-pressed='true'] {
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
	}

	.tp-timerd__num {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-timerd__num input {
		width: 4.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		min-height: 36px;
		padding: 0 0.5rem;
		text-align: right;
	}

	.tp-timerd__presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
	}

	.tp-timerd__preset {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		overflow: hidden;
	}

	.tp-timerd__preset button,
	.tp-timerd__addpreset,
	.tp-timerd__action {
		border: 0;
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 34px;
		padding: 0 0.5rem;
	}

	.tp-timerd__addpreset,
	.tp-timerd__action {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		min-height: 36px;
	}

	.tp-timerd__addpreset:disabled {
		color: var(--color-ink-500);
		cursor: default;
	}

	.tp-timerd__drop {
		color: var(--color-fg-dim);
	}

	.tp-timerd__drop:hover {
		color: var(--color-danger);
	}

	.tp-timerd__bars {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		height: 72px;
		border-bottom: 1px solid var(--color-ink-700);
	}

	.tp-timerd__bar {
		flex: 1 1 0;
		height: var(--h, 4%);
		border-radius: 2px 2px 0 0;
		background: var(--color-beacon);
	}

	.tp-timerd__bar.empty,
	.tp-timerd__bar--idle {
		height: 4%;
		background: var(--color-ink-700);
	}

	.tp-timerd__note {
		margin: 0.5rem 0 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-timerd__prefs {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		border-top: 1px solid var(--color-ink-700);
		padding-top: 1rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-timerd__prefs label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
</style>
