<script lang="ts">
	import { dateKeyOf } from '$lib/core/date-key';
	import { logEntry } from '$lib/core/log-buffer';
	import type { TpEvent } from '$lib/core/storage/db';
	import type { TpDetailProps } from '$lib/core/types';
	import {
		isSupportedYear,
		lunarOfDate,
		solarOfLunar,
		SUPPORTED_RANGE,
		type TpSolarDate
	} from '$lib/lunar/amlich';
	import {
		canChiDay,
		canChiMonth,
		canChiYear,
		fmtLunarLong,
		lunarMonthName
	} from '$lib/lunar/format';
	import { upcomingObservances, type TpObservanceId } from '$lib/lunar/observances';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		countByDateKey,
		createEvent,
		deleteEvent,
		listEventsInRange,
		lunarMonthSpan,
		monthGrid,
		readSettings,
		shiftMonth,
		sortEvents,
		updateEvent,
		weekdayLabels
	} from './service';
	import { EVENT_LIMITS } from './types';

	/**
	 * doc 07 §6 — the detail: the month with event CRUD, the agenda for the
	 * selected day, and the lunar panel (converter, can-chi, observances ahead).
	 *
	 * The grid here **is** interactive, unlike the tile's: this is a full-screen
	 * panel where forty-two focusable days is a normal number, and picking a day
	 * is the whole interaction.
	 *
	 * `empty` (doc 06 §3) lives here — the agenda for a day with nothing on it,
	 * with the one action doc 12 §8 asks for. The tile has no empty state because
	 * a month always has days in it; both halves are recorded in doc 07 §6.
	 */
	let { settings: tileSettings, onUpdateSettings }: TpDetailProps = $props();

	const OBSERVANCE_LABELS: Record<TpObservanceId, () => string> = {
		tet: () => m['widget.calendar.observance.tet'](),
		'nguyen-tieu': () => m['widget.calendar.observance.nguyen_tieu'](),
		'han-thuc': () => m['widget.calendar.observance.han_thuc'](),
		'hung-vuong': () => m['widget.calendar.observance.hung_vuong'](),
		'doan-ngo': () => m['widget.calendar.observance.doan_ngo'](),
		'vu-lan': () => m['widget.calendar.observance.vu_lan'](),
		'trung-thu': () => m['widget.calendar.observance.trung_thu'](),
		'ong-tao': () => m['widget.calendar.observance.ong_tao']()
	};

	const today = new Date();
	const prefs = $derived(readSettings(tileSettings, settings.locale));

	let view = $state({ year: today.getFullYear(), month: today.getMonth() + 1 });
	let selected = $state<TpSolarDate>({
		d: today.getDate(),
		m: today.getMonth() + 1,
		y: today.getFullYear()
	});

	let events = $state<TpEvent[]>([]);
	let failed = $state(false);
	let reloadToken = $state(0);

	/** The row being edited, or `null` while the form is adding a new one. */
	let editingId = $state<string | null>(null);
	let draftTitle = $state('');
	let draftNote = $state('');
	let confirmingDelete = $state<string | null>(null);

	/** The lunar→solar half of the converter (doc 07 §6). */
	let convertDay = $state(1);
	let convertMonth = $state(1);
	let convertYear = $state(today.getFullYear());
	let convertLeap = $state(false);

	const grid = $derived(monthGrid(view.year, view.month, settings.weekStartsOn, Date.now()));
	const weekdays = $derived(weekdayLabels(settings.locale, settings.weekStartsOn, 'short'));
	const counts = $derived(countByDateKey(events));
	const weeks = $derived(
		Array.from({ length: grid.cells.length / 7 }, (_, i) => grid.cells.slice(i * 7, i * 7 + 7))
	);

	const selectedKey = $derived(dateKeyOf(new Date(selected.y, selected.m - 1, selected.d)));
	const dayEvents = $derived(
		sortEvents(
			events.filter((event) => event.dateKey === selectedKey),
			settings.locale
		)
	);
	const selectedLunar = $derived(lunarOfDate(selected));

	const monthLabel = $derived(
		new Intl.DateTimeFormat(settings.locale, { month: 'long', year: 'numeric' }).format(
			new Date(grid.year, grid.month - 1, 1)
		)
	);
	const selectedLabel = $derived(
		new Intl.DateTimeFormat(settings.locale, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(new Date(selected.y, selected.m - 1, selected.d))
	);

	const lunarLabel = $derived.by(() => {
		const span = lunarMonthSpan(grid);
		const first = span[0];
		if (first === undefined) return m['widget.calendar.out_of_range']();
		const last = span[span.length - 1];
		if (span.length === 1 || last === undefined) {
			return m['widget.calendar.lunar_span_one']({
				month: lunarMonthName(first.month, settings.locale, first.leap)
			});
		}
		return m['widget.calendar.lunar_span_two']({
			from: lunarMonthName(first.month, settings.locale, first.leap),
			to: lunarMonthName(last.month, settings.locale, last.leap)
		});
	});

	const converted = $derived(
		solarOfLunar({
			day: convertDay,
			month: convertMonth,
			year: convertYear,
			leap: convertLeap
		})
	);

	const inRange = $derived(isSupportedYear(convertYear));

	const observances = $derived(upcomingObservances(selected, 5));

	const dateFormatter = $derived(
		new Intl.DateTimeFormat(settings.locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
	);

	function formatSolar(date: TpSolarDate): string {
		return dateFormatter.format(new Date(date.y, date.m - 1, date.d));
	}

	$effect(() => {
		// Reads the events the visible month covers, and again after a write.
		// `reloadToken` is the dependency that makes "again" happen — reloading
		// and choosing what to edit are separate operations, which the notes
		// widget learned the hard way (doc 07 §4).
		const { fromKey, toKey } = grid;
		void reloadToken;
		let cancelled = false;

		listEventsInRange(fromKey, toKey)
			.then((rows) => {
				if (cancelled) return;
				events = rows;
				failed = false;
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				logEntry('warn', 'could not read calendar events', { src: 'widget', error });
				events = [];
				failed = true;
			});

		return () => {
			cancelled = true;
		};
	});

	function goToday(): void {
		const at = new Date();
		view = { year: at.getFullYear(), month: at.getMonth() + 1 };
		selected = { d: at.getDate(), m: at.getMonth() + 1, y: at.getFullYear() };
	}

	function step(delta: number): void {
		view = shiftMonth(view.year, view.month, delta);
	}

	function pick(date: TpSolarDate): void {
		selected = date;
		cancelEdit();
	}

	function startEdit(event: TpEvent): void {
		editingId = event.id;
		draftTitle = event.title;
		draftNote = event.note ?? '';
		confirmingDelete = null;
	}

	function cancelEdit(): void {
		editingId = null;
		draftTitle = '';
		draftNote = '';
		confirmingDelete = null;
	}

	async function submit(): Promise<void> {
		const title = draftTitle.trim();
		if (title === '') return;

		const id = editingId;
		if (id === null) {
			await createEvent({ dateKey: selectedKey, title, note: draftNote });
		} else {
			await updateEvent(id, { title, note: draftNote });
		}

		cancelEdit();
		reloadToken += 1;
	}

	async function remove(id: string): Promise<void> {
		await deleteEvent(id);
		cancelEdit();
		reloadToken += 1;
	}

	function toggleCanChi(): void {
		onUpdateSettings?.({ canChi: !prefs.canChi });
	}
</script>

<div class="tp-cald">
	<section class="tp-cald__month" aria-label={monthLabel}>
		<header>
			<button type="button" onclick={() => step(-1)} aria-label={m['widget.calendar.prev_month']()}>
				<TpIcon name="expand" size={14} />
			</button>
			<div class="tp-cald__labels">
				<strong>{monthLabel}</strong>
				<span class="tp-cald__lunarspan">{lunarLabel}</span>
			</div>
			<button type="button" onclick={() => step(1)} aria-label={m['widget.calendar.next_month']()}>
				<TpIcon name="expand" size={14} />
			</button>
			<button type="button" class="tp-cald__today" onclick={goToday}>
				{m['widget.calendar.go_today']()}
			</button>
		</header>

		<table class="tp-cald__grid">
			<thead>
				<tr>
					{#each weekdays as label, i (i)}
						<th scope="col">{label}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each weeks as week, i (i)}
					<tr>
						{#each week as cell (cell.dateKey)}
							{@const count = counts.get(cell.dateKey) ?? 0}
							<td>
								<button
									type="button"
									class="tp-cald__cell"
									class:tp-cald__out={!cell.inMonth}
									class:tp-cald__todaycell={cell.isToday}
									class:tp-cald__selected={cell.dateKey === selectedKey}
									data-accent={cell.accent}
									data-testid="day-{cell.dateKey}"
									aria-current={cell.isToday ? 'date' : undefined}
									aria-pressed={cell.dateKey === selectedKey}
									onclick={() => pick(cell.date)}
								>
									<span class="tp-cald__day tp-num">{cell.date.d}</span>
									{#if cell.lunar !== null}
										<span class="tp-cald__lunarday tp-num">
											{cell.lunar.day === 1
												? `1/${String(cell.lunar.month)}${cell.lunar.leap ? 'N' : ''}`
												: cell.lunar.day}
										</span>
									{/if}
									{#if count > 0}
										<span class="tp-cald__dot" aria-hidden="true"></span>
									{/if}
								</button>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>

		{#if failed}
			<p class="tp-cald__error" role="alert">{m['widget.calendar.events_error']()}</p>
		{/if}
	</section>

	<section class="tp-cald__agenda" aria-label={m['widget.calendar.agenda']()}>
		<h3>{selectedLabel}</h3>
		{#if selectedLunar !== null}
			<p class="tp-cald__lunarline">{fmtLunarLong(selectedLunar, settings.locale)}</p>
		{/if}

		{#if dayEvents.length === 0}
			<!-- doc 06 §3's `empty`: explains, and offers exactly one action. -->
			<p class="tp-cald__empty">{m['widget.calendar.agenda_empty']()}</p>
		{:else}
			<ul class="tp-cald__events">
				{#each dayEvents as event (event.id)}
					<li>
						<div class="tp-cald__eventtext">
							<span class="tp-cald__eventtitle">{event.title}</span>
							{#if event.note !== undefined}
								<span class="tp-cald__eventnote">{event.note}</span>
							{/if}
						</div>
						<button
							type="button"
							onclick={() => startEdit(event)}
							aria-label={m['widget.calendar.edit_event']()}
						>
							<TpIcon name="edit" size={14} />
						</button>
						{#if confirmingDelete === event.id}
							<button type="button" class="tp-cald__danger" onclick={() => void remove(event.id)}>
								{m['widget.calendar.delete_confirm']()}
							</button>
						{:else}
							<button
								type="button"
								onclick={() => (confirmingDelete = event.id)}
								aria-label={m['widget.calendar.delete_event']()}
							>
								<TpIcon name="trash" size={14} />
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="tp-cald__form"
			onsubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
		>
			<input
				type="text"
				bind:value={draftTitle}
				maxlength={EVENT_LIMITS.titleMax}
				placeholder={m['widget.calendar.event_title']()}
				aria-label={m['widget.calendar.event_title']()}
				data-testid="event-title"
			/>
			<input
				type="text"
				bind:value={draftNote}
				maxlength={EVENT_LIMITS.noteMax}
				placeholder={m['widget.calendar.event_note']()}
				aria-label={m['widget.calendar.event_note']()}
			/>
			<button type="submit" disabled={draftTitle.trim() === ''}>
				{editingId === null ? m['widget.calendar.add_event']() : m['widget.calendar.save']()}
			</button>
			{#if editingId !== null}
				<button type="button" onclick={cancelEdit}>{m['widget.calendar.cancel']()}</button>
			{/if}
		</form>
	</section>

	<section class="tp-cald__lunarpanel" aria-label={m['widget.calendar.lunar']()}>
		<h3>{m['widget.calendar.lunar']()}</h3>

		{#if prefs.canChi && selectedLunar !== null}
			<dl class="tp-cald__canchi" data-testid="canchi">
				<dt>{m['widget.calendar.canchi_year']()}</dt>
				<dd>{canChiYear(selectedLunar.year)}</dd>
				<dt>{m['widget.calendar.canchi_month']()}</dt>
				<dd>{canChiMonth(selectedLunar.year, selectedLunar.month)}</dd>
				<dt>{m['widget.calendar.canchi_day']()}</dt>
				<dd>{canChiDay(selected)}</dd>
			</dl>
		{/if}

		<label class="tp-cald__toggle">
			<input type="checkbox" checked={prefs.canChi} onchange={toggleCanChi} />
			{m['widget.calendar.canchi_show']()}
		</label>

		<h4>{m['widget.calendar.converter']()}</h4>
		<div class="tp-cald__convert">
			<label>
				{m['widget.calendar.canchi_day']()}
				<input type="number" min="1" max="30" bind:value={convertDay} class="tp-num" />
			</label>
			<label>
				{m['widget.calendar.canchi_month']()}
				<input type="number" min="1" max="12" bind:value={convertMonth} class="tp-num" />
			</label>
			<label>
				{m['widget.calendar.canchi_year']()}
				<input
					type="number"
					min={SUPPORTED_RANGE.from}
					max={SUPPORTED_RANGE.to}
					bind:value={convertYear}
					class="tp-num"
				/>
			</label>
			<label class="tp-cald__toggle">
				<input type="checkbox" bind:checked={convertLeap} />
				{m['widget.calendar.leap_month']()}
			</label>
			<p class="tp-cald__result" data-testid="convert-result">
				{#if converted === null}
					<!-- Two different refusals, said differently. A leap month a year
					     does not have is not the same as a year the tables do not
					     cover, and telling a reader "outside 1900–2100" about 2026
					     would send them looking for the wrong mistake. -->
					{inRange ? m['widget.calendar.no_such_date']() : m['widget.calendar.out_of_range']()}
				{:else}
					<span class="tp-num">{formatSolar(converted)}</span>
				{/if}
			</p>
		</div>

		<h4>{m['widget.calendar.observances']()}</h4>
		{#if observances.length === 0}
			<p class="tp-cald__empty">{m['widget.calendar.out_of_range']()}</p>
		{:else}
			<ul class="tp-cald__observances">
				{#each observances as item (item.id + item.solar.y)}
					<li>
						<span>{OBSERVANCE_LABELS[item.id]()}</span>
						<span class="tp-num">{formatSolar(item.solar)}</span>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- doc 07 §6 asks for exactly this note, and it is the honest place for
		     it: the shading and the dates above are Vietnam's, not the reader's. -->
		<p class="tp-cald__note">{m['widget.calendar.tz_note']()}</p>
	</section>
</div>

<style>
	.tp-cald {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
		padding: 0.5rem 0;
	}

	@media (min-width: 60rem) {
		.tp-cald {
			grid-template-columns: 3fr 2fr;
		}

		.tp-cald__month {
			grid-row: span 2;
		}
	}

	section {
		min-width: 0;
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.tp-cald__labels {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-width: 0;
	}

	.tp-cald__labels strong {
		color: var(--color-fg);
		font-size: var(--text-md);
	}

	.tp-cald__lunarspan {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 2.5rem;
		min-height: 2.5rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
	}

	button:hover:not(:disabled) {
		color: var(--color-fg);
	}

	button:disabled {
		color: var(--color-ink-500);
		cursor: default;
	}

	/* The previous-month chevron is the next-month glyph, turned. The icon set
	   (doc 12 §6) carries one expand arrow rather than four directions. */
	header button:first-child :global(svg) {
		rotate: 180deg;
	}

	.tp-cald__today {
		flex: 0 0 auto;
	}

	.tp-cald__grid {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	th {
		padding-bottom: 0.25rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		font-weight: 500;
	}

	td {
		padding: 1px;
	}

	.tp-cald__cell {
		display: flex;
		width: 100%;
		min-width: 0;
		min-height: 2.75rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0;
		padding: 0.125rem;
		border: 1px solid transparent;
		color: var(--color-fg-mute);
		position: relative;
	}

	.tp-cald__out {
		color: var(--color-ink-500);
	}

	.tp-cald__day {
		font-size: var(--text-xs);
		line-height: 1.15;
	}

	.tp-cald__lunarday {
		color: var(--color-fg-dim);
		font-size: 0.5625rem;
		line-height: 1.1;
	}

	.tp-cald__out .tp-cald__lunarday {
		color: var(--color-ink-500);
	}

	.tp-cald__cell[data-accent='mung-mot'] .tp-cald__lunarday,
	.tp-cald__cell[data-accent='ram'] .tp-cald__lunarday {
		color: var(--color-beacon);
	}

	.tp-cald__cell[data-accent='ram'] .tp-cald__lunarday {
		font-weight: 600;
	}

	.tp-cald__todaycell {
		border-color: var(--color-beacon);
	}

	.tp-cald__selected {
		background: var(--color-beacon-soft);
		color: var(--color-fg);
	}

	.tp-cald__dot {
		position: absolute;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--color-fg-mute);
		bottom: 3px;
		left: 50%;
		translate: -50% 0;
	}

	h3 {
		margin: 0 0 0.25rem;
		color: var(--color-fg);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	h4 {
		margin: 1rem 0 0.25rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.tp-cald__lunarline {
		margin: 0 0 0.5rem;
		color: var(--color-beacon);
		font-size: var(--text-xs);
	}

	.tp-cald__empty,
	.tp-cald__note {
		margin: 0.25rem 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-cald__error {
		margin: 0.5rem 0 0;
		color: var(--color-warn);
		font-size: var(--text-2xs);
	}

	.tp-cald__events,
	.tp-cald__observances {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0.5rem 0;
		padding: 0;
		list-style: none;
	}

	.tp-cald__events li {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tp-cald__eventtext {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-width: 0;
	}

	.tp-cald__eventtitle {
		color: var(--color-fg);
		font-size: var(--text-xs);
	}

	.tp-cald__eventnote {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-cald__danger {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.tp-cald__observances li {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-cald__form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.75rem;
	}

	input[type='text'] {
		flex: 1 1 8rem;
		min-height: 2.5rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
	}

	input[type='number'] {
		width: 5rem;
		min-height: 2.5rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
	}

	.tp-cald__convert {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem;
	}

	.tp-cald__convert label {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-cald__toggle {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.375rem;
		min-height: 2.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-cald__result {
		flex: 1 1 100%;
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-sm);
	}

	.tp-cald__canchi {
		display: grid;
		gap: 0.125rem 0.75rem;
		grid-template-columns: auto 1fr;
		margin: 0.5rem 0;
		font-size: var(--text-xs);
	}

	.tp-cald__canchi dt {
		color: var(--color-fg-dim);
	}

	.tp-cald__canchi dd {
		margin: 0;
		color: var(--color-fg);
	}
</style>
