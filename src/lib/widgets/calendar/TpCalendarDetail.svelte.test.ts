import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { db } from '$lib/core/storage/db';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpCalendarDetail from './TpCalendarDetail.svelte';
import { createEvent, listEventsOn } from './service';

/**
 * doc 07 §6's detail — event CRUD, the agenda, and the lunar panel.
 *
 * Same two rules as the tile's suite: the clock is frozen at 28 August 2026,
 * and anything from the message catalogue is asserted through `m[...]()`
 * because Paraglide's locale and `settings.locale` are independent in a
 * component test (doc 14 §1's custom strategy lives in `hooks.client.ts`).
 */

/** A Friday, lunar 16/07 of Bính Ngọ. */
const NOW = new Date(2026, 7, 28, 10, 0);

function props(bag: Record<string, unknown> = {}, onUpdateSettings = vi.fn()) {
	return { instanceId: 'wgt_cal', settings: bag, onUpdateSettings, close: vi.fn() };
}

beforeEach(async () => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settings.dispose();
	settings.hydrate();
	settings.patch({ locale: 'vi', weekStartsOn: 1 });
	await db.events.clear();
});

afterEach(async () => {
	cleanup();
	await db.events.clear();
	settings.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('opening', () => {
	it('starts on the current month with today selected', async () => {
		const screen = render(TpCalendarDetail, props());

		await expect.element(screen.getByText('tháng 8 năm 2026')).toBeInTheDocument();
		await expect
			.element(screen.getByTestId('day-2026-08-28'))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('shows the selected day spelled out, with its lunar date under it', async () => {
		const screen = render(TpCalendarDetail, props());
		// 28 August 2026 is lunar 16/07 of Bính Ngọ.
		await expect.element(screen.getByText('ngày 16 tháng Bảy, Bính Ngọ')).toBeInTheDocument();
	});
});

describe('navigation', () => {
	it('steps to the next month and back', async () => {
		const screen = render(TpCalendarDetail, props());

		await screen.getByRole('button', { name: m['widget.calendar.next_month']() }).click();
		await expect.element(screen.getByText('tháng 9 năm 2026')).toBeInTheDocument();

		await screen.getByRole('button', { name: m['widget.calendar.prev_month']() }).click();
		await expect.element(screen.getByText('tháng 8 năm 2026')).toBeInTheDocument();
	});

	it('carries the year backwards across January', async () => {
		const screen = render(TpCalendarDetail, props());
		const back = screen.getByRole('button', { name: m['widget.calendar.prev_month']() });
		for (let i = 0; i < 8; i++) await back.click();

		await expect.element(screen.getByText('tháng 12 năm 2025')).toBeInTheDocument();
	});

	it('comes back to today from wherever it has wandered', async () => {
		const screen = render(TpCalendarDetail, props());
		await screen.getByRole('button', { name: m['widget.calendar.next_month']() }).click();
		await screen.getByRole('button', { name: m['widget.calendar.go_today']() }).click();

		await expect.element(screen.getByText('tháng 8 năm 2026')).toBeInTheDocument();
		await expect
			.element(screen.getByTestId('day-2026-08-28'))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('moves the selection when a day is picked', async () => {
		const screen = render(TpCalendarDetail, props());
		await screen.getByTestId('day-2026-08-20').click();

		await expect
			.element(screen.getByTestId('day-2026-08-20'))
			.toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(screen.getByTestId('day-2026-08-28'))
			.toHaveAttribute('aria-pressed', 'false');
	});
});

describe('the agenda (doc 06 §3 `empty`)', () => {
	it('explains an empty day rather than showing a blank list', async () => {
		const screen = render(TpCalendarDetail, props());
		await expect.element(screen.getByText(m['widget.calendar.agenda_empty']())).toBeInTheDocument();
	});

	it('offers exactly one action out of that state', async () => {
		// doc 12 §8: an empty state explains and offers one action.
		const screen = render(TpCalendarDetail, props());
		await expect
			.element(screen.getByRole('button', { name: m['widget.calendar.add_event']() }))
			.toBeInTheDocument();
	});

	it('lists what is on the selected day and nothing from another one', async () => {
		await createEvent({ dateKey: '2026-08-28', title: 'Họp nhóm' });
		await createEvent({ dateKey: '2026-08-20', title: 'Bác sĩ' });
		const screen = render(TpCalendarDetail, props());

		await expect.element(screen.getByText('Họp nhóm')).toBeInTheDocument();
		await expect.element(screen.getByText('Bác sĩ')).not.toBeInTheDocument();
	});
});

describe('event CRUD', () => {
	it('adds an event to the selected day', async () => {
		const screen = render(TpCalendarDetail, props());

		await screen.getByTestId('event-title').fill('Giỗ ông');
		await screen.getByRole('button', { name: m['widget.calendar.add_event']() }).click();

		await expect.element(screen.getByText('Giỗ ông')).toBeInTheDocument();
		expect((await listEventsOn('2026-08-28')).map((e) => e.title)).toEqual(['Giỗ ông']);
	});

	it('adds it to the day that is selected, not to today', async () => {
		const screen = render(TpCalendarDetail, props());
		await screen.getByTestId('day-2026-08-20').click();
		await screen.getByTestId('event-title').fill('Bác sĩ');
		await screen.getByRole('button', { name: m['widget.calendar.add_event']() }).click();

		await expect.element(screen.getByText('Bác sĩ')).toBeInTheDocument();
		expect(await listEventsOn('2026-08-28')).toHaveLength(0);
		expect(await listEventsOn('2026-08-20')).toHaveLength(1);
	});

	it('refuses to add a blank title', async () => {
		const screen = render(TpCalendarDetail, props());
		await expect
			.element(screen.getByRole('button', { name: m['widget.calendar.add_event']() }))
			.toBeDisabled();
	});

	it('renames an event in place', async () => {
		await createEvent({ dateKey: '2026-08-28', title: 'Cũ' });
		const screen = render(TpCalendarDetail, props());

		await screen.getByRole('button', { name: m['widget.calendar.edit_event']() }).click();
		await screen.getByTestId('event-title').fill('Mới');
		await screen.getByRole('button', { name: m['widget.calendar.save']() }).click();

		await expect.element(screen.getByText('Mới')).toBeInTheDocument();
		expect((await listEventsOn('2026-08-28')).map((e) => e.title)).toEqual(['Mới']);
	});

	it('deletes only after a confirm, which is a second click', async () => {
		await createEvent({ dateKey: '2026-08-28', title: 'Họp nhóm' });
		const screen = render(TpCalendarDetail, props());

		await screen.getByRole('button', { name: m['widget.calendar.delete_event']() }).click();
		// Still there — the first click only arms the confirm.
		expect(await listEventsOn('2026-08-28')).toHaveLength(1);

		await screen.getByRole('button', { name: m['widget.calendar.delete_confirm']() }).click();
		await expect.element(screen.getByText(m['widget.calendar.agenda_empty']())).toBeInTheDocument();
		expect(await listEventsOn('2026-08-28')).toHaveLength(0);
	});
});

describe('the lunar panel (doc 07 §6)', () => {
	it('shows can-chi for the year, month and day', async () => {
		const screen = render(TpCalendarDetail, props({ canChi: true }));

		// 28 August 2026: lunar 16/07 of Bính Ngọ, tháng Bính Thân, ngày Giáp
		// Tuất. The day's can-chi counts in Julian days and is checked against
		// the J2000 anchor in `format.test.ts`.
		const canchi = screen.container.querySelector('[data-testid="canchi"]');
		expect(canchi?.textContent).toContain('Bính Ngọ');
		expect(canchi?.textContent).toContain('Giáp Tuất');
		await expect.element(screen.getByText(m['widget.calendar.canchi_show']())).toBeInTheDocument();
	});

	it('hides can-chi when the setting is off, which is the English default', async () => {
		const screen = render(TpCalendarDetail, props({ canChi: false }));
		expect(screen.container.querySelector('[data-testid="canchi"]')).toBeNull();
		// The agenda's lunar line stays — it is the date, not the can-chi.
		await expect.element(screen.getByText('ngày 16 tháng Bảy, Bính Ngọ')).toBeInTheDocument();
	});

	it('writes the toggle back through onUpdateSettings (doc 06 §2)', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(TpCalendarDetail, props({ canChi: true }, onUpdateSettings));

		await screen.getByRole('checkbox', { name: m['widget.calendar.canchi_show']() }).click();
		// Through `waitFor` rather than straight after the click — doc 19 §4.
		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({ canChi: false });
		});
	});

	it('converts a lunar date back to a solar one', async () => {
		const screen = render(TpCalendarDetail, props());

		// Lunar 1/1/2026 is Tết, on 17 February 2026.
		await screen.getByLabelText(m['widget.calendar.canchi_year']()).fill('2026');
		await expect.element(screen.getByTestId('convert-result')).toHaveTextContent('17/02/2026');
	});

	it('says so rather than guessing when the leap month does not exist', async () => {
		const screen = render(TpCalendarDetail, props());

		// 2026 has no leap month at all, so a leap 1/1 of 2026 is not a date —
		// the case `convertLunar2Solar` silently answered before `solarOfLunar`
		// started verifying its own answer.
		await screen.getByLabelText(m['widget.calendar.canchi_year']()).fill('2026');
		await screen.getByRole('checkbox', { name: m['widget.calendar.leap_month']() }).click();
		await expect
			.element(screen.getByTestId('convert-result'))
			.toHaveTextContent(m['widget.calendar.no_such_date']());
	});

	it('says something different for a year the tables do not cover', async () => {
		// "outside 1900–2100" about 2026 would send a reader looking for the
		// wrong mistake, so the two refusals are not the same sentence.
		const screen = render(TpCalendarDetail, props());
		await screen.getByLabelText(m['widget.calendar.canchi_year']()).fill('2200');
		await expect
			.element(screen.getByTestId('convert-result'))
			.toHaveTextContent(m['widget.calendar.out_of_range']());
	});

	it('lists the observances ahead of the selected day', async () => {
		const screen = render(TpCalendarDetail, props());

		// 28 August 2026: Trung thu (25 September) is the next one on the table.
		await expect
			.element(screen.getByText(m['widget.calendar.observance.trung_thu']()))
			.toBeInTheDocument();
		await expect.element(screen.getByText('25/09/2026')).toBeInTheDocument();
	});

	it('carries doc 07 §6 note about the pinned zone', async () => {
		const screen = render(TpCalendarDetail, props());
		await expect.element(screen.getByText(m['widget.calendar.tz_note']())).toBeInTheDocument();
	});
});
