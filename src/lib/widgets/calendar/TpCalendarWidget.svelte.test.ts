import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { scheduler } from '$lib/core/scheduler';
import { db } from '$lib/core/storage/db';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpCalendarWidget from './TpCalendarWidget.svelte';
import { createEvent } from './service';

/**
 * doc 07 §6's tile, and doc 06 §3's states for it.
 *
 * The clock is frozen at 28 August 2026 in every case. A calendar tested
 * against `Date.now()` is a calendar that passes until the first of the month,
 * and the lunar assertions below name specific days.
 *
 * `events` is cleared around each case. The browser project runs in its own
 * Playwright context, so this is not the developer's own IndexedDB — but it is
 * shared between cases in a run, and a dot left behind by one of them would
 * make the next pass for the wrong reason.
 *
 * **`settings.locale` and Paraglide's locale are two different things here.**
 * The custom strategy that ties them together lives in `hooks.client.ts`
 * (doc 14 §1) and is not installed in a component test, so `Intl` output
 * follows the store while `m.*()` follows `navigator.language` — which the test
 * browser reports as en-US. Hence: literal strings for anything `Intl`
 * formatted, `m[...]()` for anything from the catalogue. Asserting a Vietnamese
 * message literal here would fail for a reason that has nothing to do with the
 * widget.
 */

const SIZE: TpTileSize = { w: 3, h: 3, pxW: 320, pxH: 320, tier: 'M' };
const NARROW: TpTileSize = { w: 2, h: 2, pxW: 160, pxH: 160, tier: 'M' };

/** A Friday, lunar 16/07 of Bính Ngọ. Local constructor: zone-independent. */
const NOW = new Date(2026, 7, 28, 10, 0);

function props(size: TpTileSize = SIZE) {
	return { instanceId: 'wgt_cal', settings: {}, size };
}

beforeEach(async () => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settings.dispose();
	settings.hydrate();
	// The test browser reports en-US, so the store's `navigator.language`
	// default lands on English. Vietnamese is what most of these cases are
	// about, so it is set rather than assumed.
	settings.patch({ locale: 'vi' });
	scheduler.reset();
	await db.events.clear();
});

afterEach(async () => {
	cleanup();
	scheduler.reset();
	await db.events.clear();
	settings.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('the month grid', () => {
	it('shows the current month and names it in the header', async () => {
		const screen = render(TpCalendarWidget, props());
		await expect.element(screen.getByText('tháng 8 năm 2026')).toBeInTheDocument();
	});

	it('rings today, and only today', async () => {
		const screen = render(TpCalendarWidget, props());
		const ringed = screen.container.querySelectorAll('[aria-current="date"]');
		expect(ringed).toHaveLength(1);
		expect(ringed[0]?.textContent).toContain('28');
	});

	it('draws whole weeks, so the first row is never ragged', async () => {
		const screen = render(TpCalendarWidget, props());
		const rows = screen.container.querySelectorAll('tbody tr');
		expect(rows.length).toBeGreaterThan(3);
		for (const row of rows) expect(row.querySelectorAll('td')).toHaveLength(7);
	});

	it('labels the weekdays from the locale, starting where the setting says', async () => {
		settings.patch({ weekStartsOn: 1 });
		const screen = render(TpCalendarWidget, props());
		const heads = [...screen.container.querySelectorAll('th')].map((th) => th.textContent);
		expect(heads).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
	});
});

describe('the lunar overlay (doc 07 §6)', () => {
	it('carries the lunar span in the header alongside the solar month', async () => {
		// August 2026 runs from lunar month 6 into lunar month 7.
		const screen = render(TpCalendarWidget, props());
		await expect
			.element(
				screen.getByText(
					m['widget.calendar.lunar_span_two']({ from: 'tháng Sáu', to: 'tháng Bảy' })
				)
			)
			.toBeInTheDocument();
	});

	it('marks the day a lunar month opens with its month number', async () => {
		// 12 August 2026 is lunar 1/7 — the reader needs to see *which* month
		// started, not just that one did.
		const screen = render(TpCalendarWidget, props());
		await expect.element(screen.getByText('1/7', { exact: true })).toBeInTheDocument();
	});

	it('accents mùng 1 and rằm and nothing else', async () => {
		const screen = render(TpCalendarWidget, props());
		const accented = screen.container.querySelectorAll('td[data-accent]');
		// `data-accent` is only set when the overlay is showing, so it says what
		// it means rather than sitting on cells that render no lunar day.
		// Two lunar months touch this grid, so there are two of each at most.
		expect(accented.length).toBeGreaterThan(0);
		for (const cell of accented) {
			expect(['mung-mot', 'ram']).toContain(cell.getAttribute('data-accent'));
		}
	});

	it('leaves the lunar numbers off in English', async () => {
		// doc 07 §6 keys the overlay to the locale, not to a setting.
		settings.patch({ locale: 'en' });
		const screen = render(TpCalendarWidget, props());
		await expect.element(screen.getByText('August 2026')).toBeInTheDocument();
		expect(screen.container.querySelectorAll('td[data-accent]')).toHaveLength(0);
	});

	it('leaves them off when the tile is too narrow to carry them', async () => {
		// Below this the cells are numbers and nothing else — two figures in a
		// 20-pixel box is worse than one.
		const screen = render(TpCalendarWidget, props(NARROW));
		expect(screen.container.querySelectorAll('td[data-accent]')).toHaveLength(0);
	});
});

describe('events', () => {
	it('dots a day that has something on it, and leaves the rest alone', async () => {
		await createEvent({ dateKey: '2026-08-20', title: 'Họp nhóm' });
		const screen = render(TpCalendarWidget, props());

		await vi.waitFor(() => {
			expect(screen.container.querySelectorAll('.tp-cal__dot')).toHaveLength(1);
		});
	});

	it('says so inline when the read fails, and keeps the grid up', async () => {
		// doc 13 §7: a tile never blanks. The month is a pure computation and has
		// no reason to disappear because a storage read did.
		vi.spyOn(db.events, 'where').mockImplementation(() => {
			throw new Error('idb unavailable');
		});
		const screen = render(TpCalendarWidget, props());

		await expect.element(screen.getByText(m['widget.calendar.events_error']())).toBeInTheDocument();
		await expect.element(screen.getByText('tháng 8 năm 2026')).toBeInTheDocument();
	});
});

describe('the scheduler wiring (doc 04 §3)', () => {
	it('registers exactly one midnight task while mounted', async () => {
		render(TpCalendarWidget, props());

		const tasks = scheduler.inspect();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.cadence).toEqual({ kind: 'midnight' });
	});

	it('unregisters it on unmount, so removing the tile leaves nothing behind', async () => {
		// doc 19 §6's "no scheduler leaks on remove", now that the registration
		// lives in the widget rather than in the host.
		render(TpCalendarWidget, props());
		expect(scheduler.size).toBe(1);

		cleanup();
		expect(scheduler.size).toBe(0);
	});
});
