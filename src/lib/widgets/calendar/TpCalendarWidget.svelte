<script lang="ts">
	import { logEntry } from '$lib/core/log-buffer';
	import { useRefresh } from '$lib/core/refresh.svelte';
	import type { TpEvent } from '$lib/core/storage/db';
	import type { TpWidgetProps } from '$lib/core/types';
	import { lunarMonthName } from '$lib/lunar/format';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import {
		countByDateKey,
		listEventsInRange,
		lunarMonthSpan,
		monthGrid,
		weekdayLabels
	} from './service';

	/**
	 * doc 07 §6 — the tile: the current month as a mini-grid, today ringed, a dot
	 * per day that has something on it, and the lunar day in small type when the
	 * locale is Vietnamese, with mùng 1 and rằm accented.
	 *
	 * Read-only, deliberately. Every cell as a button would put forty-two tab
	 * stops on the deck for a widget whose whole job is to be glanced at
	 * (doc 12 §1); picking a day, adding an event and the lunar panel are all the
	 * detail's, which is what doc 07 §6 gives it.
	 *
	 * **States (doc 06 §3, pure-client class).** `ready` and `error` are here;
	 * `stale`, `stale-error` and `offline` do not apply to a widget with no
	 * network. Two are unreachable for this widget rather than for its class, and
	 * are named here rather than left as a silent gap:
	 *
	 * - no `loading`, because the grid is a pure computation over the date and is
	 *   on screen in the first frame. Only the event dots wait on Dexie, and a
	 *   skeleton over a calendar that is already legible would be a flash of
	 *   worse information, which is the opposite of what doc 13 §7 asks for.
	 * - no `empty`, because a month always has thirty-odd days in it. The empty
	 *   state this widget genuinely has — a day with nothing on it — belongs to
	 *   the detail's agenda, and is implemented there.
	 *
	 * `error` **is** reachable and is inline: if the event read fails the grid
	 * stays up and says so, rather than blanking or silently showing no dots.
	 */
	// No `settings` here on purpose: the one per-instance setting this widget has
	// is `canChi` (doc 14 §3), and the tile never shows can-chi — it has room for
	// a number per cell and nothing more. The detail owns it.
	let { size }: TpWidgetProps = $props();

	let now = $state(Date.now());
	let events = $state<TpEvent[] | null>(null);
	let failed = $state(false);

	// doc 06 §7: `midnight`. Rolls the ring onto the new day, and pulls the grid
	// into the new month on the first of it. `useRefresh` owns the teardown.
	useRefresh(
		'calendar',
		{ kind: 'midnight' },
		() => {
			now = Date.now();
		},
		{ label: 'calendar:midnight' }
	);

	const grid = $derived(
		monthGrid(new Date(now).getFullYear(), new Date(now).getMonth() + 1, settings.weekStartsOn, now)
	);

	const weekdays = $derived(weekdayLabels(settings.locale, settings.weekStartsOn));
	const counts = $derived(countByDateKey(events ?? []));

	/** Whole weeks, so a plain chunk is exact — `monthGrid` guarantees it. */
	const weeks = $derived(
		Array.from({ length: grid.cells.length / 7 }, (_, i) => grid.cells.slice(i * 7, i * 7 + 7))
	);

	const solarLabel = $derived(
		new Intl.DateTimeFormat(settings.locale, { month: 'long', year: 'numeric' }).format(
			new Date(grid.year, grid.month - 1, 1)
		)
	);

	/** doc 07 §6: the header carries both. One label or two, never a range that
	 *  pretends the month spans three lunar months. */
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

	/** The lunar overlay is locale-driven, not a setting (doc 07 §6), and it
	 *  needs room: below this the cells are numbers and nothing else.
	 *
	 *  186 and not the 210 this shipped with: `pxW` is the content box, and
	 *  restoring gridstack's 12 px item margin took 24 px off it at every size.
	 *  Held at 210 the same tile would have lost the overlay it has today. */
	const showLunar = $derived(settings.locale === 'vi' && size.pxW >= 186);

	/** doc 07 §6: `1/7` on the day a lunar month opens, so the reader can see
	 *  *which* month started; the bare day everywhere else. */
	function lunarText(cell: (typeof grid.cells)[number]): string {
		if (cell.lunar === null) return '';
		if (cell.lunar.day !== 1) return String(cell.lunar.day);
		return `1/${String(cell.lunar.month)}${cell.lunar.leap ? 'N' : ''}`;
	}

	$effect(() => {
		// Reads the events the visible grid covers. Local storage, not the
		// network — doc 06 §6's "effects never fetch" is about `/api/*`.
		const { fromKey, toKey } = grid;
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
</script>

<div class="tp-cal" data-tier={size.tier} class:tp-cal--compact={!showLunar}>
	<header>
		<span class="tp-cal__solar">{solarLabel}</span>
		{#if size.tier !== 'S'}
			<span class="tp-cal__lunar">{lunarLabel}</span>
		{/if}
	</header>

	<table class="tp-cal__grid" aria-label={solarLabel}>
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
						<td
							class:tp-cal__out={!cell.inMonth}
							class:tp-cal__today={cell.isToday}
							data-accent={showLunar ? cell.accent : undefined}
							aria-current={cell.isToday ? 'date' : undefined}
						>
							<span class="tp-cal__day tp-num">{cell.date.d}</span>
							{#if showLunar}
								<span class="tp-cal__lunarday tp-num">{lunarText(cell)}</span>
							{/if}
							{#if count > 0}
								<span class="tp-cal__dot" title={m['widget.calendar.events_count']({ count })}
								></span>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	{#if failed}
		<p class="tp-cal__error" role="alert">{m['widget.calendar.events_error']()}</p>
	{/if}
</div>

<style>
	.tp-cal {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.25rem;
		overflow: hidden;
	}

	header {
		display: flex;
		flex: 0 0 auto;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
		overflow: hidden;
		color: var(--color-fg);
		font-size: var(--text-xs);
	}

	.tp-cal__solar {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-cal__lunar {
		flex: 0 1 auto;
		overflow: hidden;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-cal__grid {
		flex: 1 1 auto;
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		min-height: 0;
	}

	th {
		padding-bottom: 0.125rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		font-weight: 500;
	}

	td {
		position: relative;
		height: 1px; /* with table-layout: fixed, rows share the body height */
		color: var(--color-fg-mute);
		text-align: center;
		vertical-align: middle;
	}

	.tp-cal__out {
		color: var(--color-ink-500);
	}

	.tp-cal__day {
		display: block;
		font-size: var(--text-2xs);
		line-height: 1.15;
	}

	.tp-cal--compact .tp-cal__day {
		font-size: var(--text-xs);
	}

	.tp-cal__lunarday {
		display: block;
		color: var(--color-fg-dim);
		font-size: 0.5625rem;
		line-height: 1.1;
	}

	.tp-cal__out .tp-cal__lunarday {
		color: var(--color-ink-500);
	}

	/* doc 07 §6: the lunar month boundaries are what a Vietnamese reader looks
	   for first, so they are the one thing in the grid with any colour on it. */
	td[data-accent='mung-mot'] .tp-cal__lunarday,
	td[data-accent='ram'] .tp-cal__lunarday {
		color: var(--color-beacon);
	}

	td[data-accent='ram'] .tp-cal__lunarday {
		font-weight: 600;
	}

	/* The ring, not a fill: doc 12 §4 allows one beacon per view and the lunar
	   accents have already spent it, so today is drawn rather than painted. */
	.tp-cal__today .tp-cal__day {
		color: var(--color-fg);
		font-weight: 600;
	}

	.tp-cal__today::after {
		position: absolute;
		border: 1px solid var(--color-beacon);
		border-radius: var(--radius-ctl);
		content: '';
		inset: 1px;
		pointer-events: none;
	}

	.tp-cal__dot {
		position: absolute;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--color-fg-mute);
		bottom: 1px;
		left: 50%;
		translate: -50% 0;
	}

	.tp-cal__error {
		flex: 0 0 auto;
		margin: 0;
		color: var(--color-warn);
		font-size: var(--text-2xs);
	}
</style>
