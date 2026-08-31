import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { FX_HISTORY_DAYS, type TpApiResponse, type TpFxHistoryPayload } from '$lib/api-types';
import { FX_OK, FX_PAYLOAD } from '$lib/core/__fixtures__/fx';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { swrCache } from '$lib/core/swr.svelte';
import { fmtPercentChange } from '$lib/i18n/fmt';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { change24h } from './service';
import TpCurrencyDetail from './TpCurrencyDetail.svelte';

/** 2026-08-31T10:00Z, near where `__fixtures__/fx.ts` was recorded. */
const NOW = new Date(Date.UTC(2026, 7, 31, 10, 0));

let db: TpDb;

function props(over: Record<string, unknown> = {}) {
	return {
		instanceId: 'wgt_fx',
		settings: { base: 'USD', quote: 'VND', amount: 1, targets: ['VND', 'EUR'] },
		close: () => undefined,
		db,
		...over
	};
}

/**
 * Two endpoints now, so one blanket answer will not do: `/api/fx/history`
 * returns a different shape, and a URL glob for the rates would match it too.
 */
function serve(
	body: unknown,
	init: ResponseInit = {},
	history: TpApiResponse<TpFxHistoryPayload> = HISTORY_EMPTY
): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const payload = String(input).includes('/history') ? history : body;
			return new Response(JSON.stringify(payload), {
				...init,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

/** A window with nothing recorded in it — the day the app deploys. */
const HISTORY_EMPTY: TpApiResponse<TpFxHistoryPayload> = {
	ok: true,
	data: { base: 'USD', quote: 'VND', points: [], attribution: FX_PAYLOAD.attribution },
	meta: { cachedAt: 1_788_134_551, source: 'er-api', stale: false }
};

/** Enough recorded days to clear doc 08 §2’s threshold. */
function historyWith(count: number): TpApiResponse<TpFxHistoryPayload> {
	const day = 24 * 60 * 60 * 1000;
	const points = Array.from({ length: count }, (_, i) => ({
		date: new Date(NOW.getTime() - (count - 1 - i) * day).toISOString().slice(0, 10),
		rate: 25_900 + i * 8
	}));
	return {
		ok: true,
		data: { base: 'USD', quote: 'VND', points, attribution: FX_PAYLOAD.attribution },
		meta: { cachedAt: 1_788_134_551, source: 'er-api', stale: false }
	};
}

/** Yesterday stripped out — the shape the app produces on the day it deploys. */
function dayOne(): unknown {
	return { ...FX_OK, data: { ...FX_PAYLOAD, prevRates: null, prevDate: null } };
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settings.dispose();
	settings.hydrate();
	swrCache.reset();
	online.reset();
	db = createDb(`tilepier-fxd-${crypto.randomUUID()}`);
});

afterEach(async () => {
	cleanup();
	swrCache.reset();
	online.reset();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
	db.close();
	await db.delete();
});

describe('the rate table (doc 08 §2)', () => {
	it('renders a row per target, against one base amount', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-row-VND')).toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-row-EUR')).toBeInTheDocument();
	});

	it('keeps a row upstream stopped quoting, and marks it', async () => {
		// doc 08 §2's edge case, seen from the detail: the row stays so the reader
		// can find and remove it, rather than vanishing with their setting.
		serve(FX_OK);
		const screen = render(
			TpCurrencyDetail,
			props({ settings: { base: 'USD', targets: ['VND', 'ZWL'] } })
		);

		await expect
			.element(screen.getByTestId('currency-row-ZWL'))
			.toHaveTextContent(m['widget.currency.unavailable']({ code: 'ZWL' }));
	});

	it('offers an empty table rather than pretending there is nothing to do', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyDetail, props({ settings: { base: 'USD', targets: [] } }));

		await expect.element(screen.getByTestId('currency-detail-empty')).toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-add')).toBeInTheDocument();
	});
});

describe('the 24 h change', () => {
	it('is a signed percentage against the day it is comparing with', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyDetail, props());

		await expect
			.element(screen.getByTestId('currency-change-header'))
			.toHaveTextContent(m['widget.currency.col_change']({ date: '2026-08-30' }));

		const expected = change24h(FX_PAYLOAD, 'USD', 'VND') as number;
		await expect
			.element(screen.getByTestId('currency-change-VND'))
			.toHaveTextContent(fmtPercentChange(expected, settings.locale));
	});

	it('carries the direction as more than colour', async () => {
		// doc 12 §4.2: never colour alone. Intl already puts the sign in the text,
		// so the tint is reinforcement — but the attribute is what a test can see.
		serve(FX_OK);
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-change-VND')).toBeInTheDocument();
		const cell = screen.container.querySelector(
			'[data-testid="currency-change-VND"]'
		) as HTMLElement;
		// VND rose against the dollar between the fixture's two days.
		expect(cell.dataset['dir']).toBe('up');
		expect(cell.textContent).toMatch(/[+-]/);
	});

	it('has no column at all on the day the app deploys', async () => {
		// Not a column of zeros. A 0.00 % is a claim about the market; an absent
		// column is the truth about what has been recorded so far.
		serve(dayOne());
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-row-VND')).toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-change-header')).not.toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-change-VND')).not.toBeInTheDocument();
	});

	it('says why the column is missing rather than leaving a hole', async () => {
		serve(dayOne());
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-no-change-yet')).toBeInTheDocument();
	});
});

describe('editing the table (doc 06 §2)', () => {
	it('adds a currency the reader picked', async () => {
		serve(FX_OK);
		const onUpdateSettings = vi.fn();
		const screen = render(TpCurrencyDetail, props({ onUpdateSettings }));

		await expect.element(screen.getByTestId('currency-add-code')).toBeInTheDocument();
		await screen.getByTestId('currency-add-code').selectOptions('JPY');
		await screen.getByTestId('currency-add').click();

		await vi.waitFor(() =>
			expect(onUpdateSettings).toHaveBeenCalledWith({ targets: ['VND', 'EUR', 'JPY'] })
		);
	});

	it('removes one', async () => {
		serve(FX_OK);
		const onUpdateSettings = vi.fn();
		const screen = render(TpCurrencyDetail, props({ onUpdateSettings }));

		await expect.element(screen.getByTestId('currency-remove-VND')).toBeInTheDocument();
		await screen.getByTestId('currency-remove-VND').click();

		await vi.waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({ targets: ['EUR'] }));
	});

	it('reorders by swapping with the neighbour', async () => {
		serve(FX_OK);
		const onUpdateSettings = vi.fn();
		const screen = render(TpCurrencyDetail, props({ onUpdateSettings }));

		await expect.element(screen.getByTestId('currency-down-VND')).toBeInTheDocument();
		await screen.getByTestId('currency-down-VND').click();

		await vi.waitFor(() =>
			expect(onUpdateSettings).toHaveBeenCalledWith({ targets: ['EUR', 'VND'] })
		);
	});

	it('does nothing at the ends of the list', async () => {
		// The guard that stops a reorder from silently dropping a row off the
		// front of the array, which is what an unguarded swap with index -1 does.
		serve(FX_OK);
		const onUpdateSettings = vi.fn();
		const screen = render(TpCurrencyDetail, props({ onUpdateSettings }));

		await expect.element(screen.getByTestId('currency-up-VND')).toBeInTheDocument();
		await screen.getByTestId('currency-up-VND').click();
		await screen.getByTestId('currency-down-EUR').click();

		await vi.waitFor(() => expect(onUpdateSettings).not.toHaveBeenCalled());
	});

	it('persists the base amount, and writes nothing while the field is empty', async () => {
		serve(FX_OK);
		const onUpdateSettings = vi.fn();
		const screen = render(TpCurrencyDetail, props({ onUpdateSettings }));

		await expect.element(screen.getByTestId('currency-detail-amount')).toBeInTheDocument();
		await screen.getByTestId('currency-detail-amount').fill('');
		await vi.waitFor(() => expect(onUpdateSettings).not.toHaveBeenCalled());

		await screen.getByTestId('currency-detail-amount').fill('40');
		await vi.waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({ amount: 40 }));
	});
});

describe('the panel’s own states', () => {
	it('shows an offline note rather than an empty panel', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				await Promise.resolve();
				throw new TypeError('Failed to fetch');
			})
		);
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-detail-offline')).toBeInTheDocument();
	});

	it('shows one sentence and a retry when the rates could not be read', async () => {
		serve({ ok: false, error: { code: 'UPSTREAM_DOWN' } }, { status: 503 });
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-detail-error')).toBeInTheDocument();
		await expect.element(screen.getByText(m['common.retry']())).toBeInTheDocument();
	});

	it('credits ExchangeRate-API with a real link (doc 16 §5)', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-detail-credit')).toBeInTheDocument();
		const credit = screen.container.querySelector(
			'[data-testid="currency-detail-credit"]'
		) as unknown as HTMLAnchorElement;
		expect(credit.getAttribute('href')).toContain('exchangerate-api.com');
		expect(credit.textContent?.trim()).toBe(FX_PAYLOAD.attribution);
	});

	it('registers no scheduler task, because a 12 h cadence cannot fire in a panel', async () => {
		const { scheduler } = await import('$lib/core/scheduler');
		scheduler.reset();
		serve(FX_OK);
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-row-VND')).toBeInTheDocument();
		expect(scheduler.size).toBe(0);
	});
});

describe('the history chart (doc 08 §2)', () => {
	it('says how far the record has got rather than drawing three points', async () => {
		// The honest empty state. A chart over three days implies the other
		// eighty-seven were flat, which is a claim about the market rather than
		// about what has been recorded.
		serve(FX_OK, {}, historyWith(3));
		const screen = render(TpCurrencyDetail, props());

		await expect
			.element(screen.getByTestId('currency-history-building'))
			.toHaveTextContent(m['widget.currency.history_building']({ have: '3', need: '14' }));
		await expect.element(screen.getByTestId('chart-canvas')).not.toBeInTheDocument();
	});

	it('draws once enough days have been recorded', async () => {
		serve(FX_OK, {}, historyWith(20));
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('chart-canvas')).toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-history-building')).not.toBeInTheDocument();
	});

	it('pairs the chart with doc 13 §8’s summary line', async () => {
		serve(FX_OK, {}, historyWith(20));
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('chart-summary')).toBeInTheDocument();
		const caption = screen.container.querySelector('[data-testid="chart-summary"]') as HTMLElement;
		// The pair, the range and the move — doc 13 §8 wants a sentence a reader can
		// act on, not the word “chart”.
		expect(caption.textContent).toContain('USD');
		expect(caption.textContent).toContain('VND');
		expect(caption.textContent?.trim().length).toBeGreaterThan(20);
	});

	it('offers every range the endpoint will answer for, and no others', async () => {
		// The allowlist lives in `api-types.ts` precisely so the picker and the
		// Worker cannot drift: a button asking for a range the endpoint refuses
		// would be a 400 the reader has no way to understand.
		serve(FX_OK, {}, historyWith(20));
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-history')).toBeInTheDocument();
		for (const range of FX_HISTORY_DAYS) {
			await expect.element(screen.getByTestId(`currency-range-${range}`)).toBeInTheDocument();
		}
	});

	it('opens on ninety days, and re-fetches when the range changes', async () => {
		serve(FX_OK, {}, historyWith(20));
		const screen = render(TpCurrencyDetail, props());

		await expect.element(screen.getByTestId('currency-range-90')).toBeInTheDocument();
		const opened = screen.container.querySelector(
			'[data-testid="currency-range-90"]'
		) as HTMLElement;
		expect(opened.getAttribute('aria-pressed')).toBe('true');

		await screen.getByTestId('currency-range-30').click();

		await vi.waitFor(() => {
			const asked = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
				.map((call) => String(call[0]))
				.filter((url) => url.includes('/history'));
			expect(asked.some((url) => url.includes('days=30'))).toBe(true);
		});
	});
});
