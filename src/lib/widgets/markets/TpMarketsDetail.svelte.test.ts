import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { CRYPTO_OK } from '$lib/core/__fixtures__/crypto';
import { scheduler } from '$lib/core/scheduler';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { swrCache } from '$lib/core/swr.svelte';
import { tileStatusChannel } from '$lib/core/tile-status';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpMarketsDetail from './TpMarketsDetail.svelte';

/**
 * The markets detail, in the browser project.
 *
 * It asserts the **canvas**, not the panel, for the reason journey #3 records
 * (doc 19 §4): the chart module is a separate lazy request, so "the detail
 * opened" would pass with the chunk still in flight and the picture never
 * drawn.
 */

const NOW = new Date(Date.UTC(2026, 8, 1, 0, 0));

const WATCHLIST = [
	{ kind: 'crypto', symbol: 'BTCUSDT', display: 'BTC' },
	{ kind: 'crypto', symbol: 'DOGEUSDT', display: '' }
];

let db: TpDb;

function props(over: Record<string, unknown> = {}) {
	return {
		instanceId: 'wgt_mk',
		settings: { watchlist: WATCHLIST },
		close: () => undefined,
		db,
		...over
	};
}

/** `[openTime, open, high, low, close, volume]`, `count` candles apart by a
 *  minute — the normalised shape, which is what `/api/crypto/klines` answers. */
function candles(count: number): number[][] {
	return Array.from({ length: count }, (_, i) => [
		1_788_000_000_000 + i * 60_000,
		100 + i,
		110 + i,
		95 + i,
		105 + i,
		12 + i
	]);
}

/** Answers the ticker and the klines routes with their own bodies. */
function serveBoth(klines: unknown, ticker: unknown = CRYPTO_OK): ReturnType<typeof vi.fn> {
	const spy = vi.fn(async (input: string) => {
		const url = String(input);
		const body = url.includes('/api/crypto/klines') ? klines : ticker;
		return new Response(JSON.stringify(body), {
			headers: { 'content-type': 'application/json' }
		});
	});
	vi.stubGlobal('fetch', spy);
	return spy;
}

function klinesEnvelope(count: number): unknown {
	return {
		ok: true,
		data: {
			symbol: 'BTCUSDT',
			interval: '5m',
			candles: candles(count),
			attribution: 'Crypto data by Binance'
		},
		meta: { cachedAt: 1_788_220_800, source: 'binance', stale: false }
	};
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settings.dispose();
	settings.hydrate();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	tileStatusChannel.clear();
	db = createDb(`tilepier-mkd-${crypto.randomUUID()}`);
});

afterEach(async () => {
	cleanup();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	tileStatusChannel.clear();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
	db.close();
	await db.delete();
});

describe('the header', () => {
	it('opens on the first watchlist symbol, under its reader label', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());

		await expect.element(screen.getByRole('heading', { name: 'BTC' })).toBeInTheDocument();
	});

	it('carries the price, the signed change and the day band', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());

		await expect.element(screen.getByText('62,910.53')).toBeInTheDocument();
		await expect.element(screen.getByText('+2.13%')).toBeInTheDocument();
		await expect
			.element(
				screen.getByText(m['widget.markets.day_range']({ low: '61,200.45', high: '63,200.00' }))
			)
			.toBeInTheDocument();
	});

	it('says so plainly when the watchlist has nothing to show', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props({ settings: { watchlist: [] } }));

		await expect
			.element(screen.getByText(m['widget.markets.nothing_selected']()))
			.toBeInTheDocument();
	});
});

describe('the chart', () => {
	it('draws a canvas once the lazy chunk has landed', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());

		// The canvas, not the panel: the chart module is a separate request, so
		// asserting the panel would pass with the picture never drawn.
		await expect.element(screen.getByTestId('chart-canvas')).toBeInTheDocument();
	});

	it('pairs it with doc 13 §8’s summary line', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());

		await expect.element(screen.getByTestId('chart-summary')).toBeInTheDocument();
		const caption = screen.container.querySelector('[data-testid="chart-summary"]') as HTMLElement;
		// The same four facts the picture carries: where it opened, where it
		// closed, and the band between.
		expect(caption.textContent).toContain('BTC');
	});

	it('renders the empty state rather than an empty chart', async () => {
		serveBoth({
			ok: true,
			data: { symbol: 'BTCUSDT', interval: '5m', candles: [], attribution: '' },
			meta: { cachedAt: 1, source: 'binance', stale: false }
		});
		const screen = render(TpMarketsDetail, props());

		await expect.element(screen.getByText(m['widget.markets.chart_empty']())).toBeInTheDocument();
		await expect.element(screen.getByTestId('chart-canvas')).not.toBeInTheDocument();
	});
});

describe('the ranges', () => {
	it('offers the four the endpoint will answer for, and no MAX', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());

		for (const label of ['range_1d', 'range_1w', 'range_1m', 'range_1y'] as const) {
			await expect
				.element(screen.getByRole('button', { name: m[`widget.markets.${label}`]() }))
				.toBeInTheDocument();
		}
		// Week 5's one approved depth cut (doc 23 §Week 5).
		expect(screen.container.textContent).not.toContain('MAX');
	});

	it('asks for the interval and depth the chosen range names', async () => {
		const spy = serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());
		await expect.element(screen.getByTestId('chart-canvas')).toBeInTheDocument();

		await screen.getByRole('button', { name: m['widget.markets.range_1y']() }).click();

		// 1Y is `{ interval: '1d', limit: 365 }` in `CRYPTO_RANGES`, and the
		// endpoint refuses any depth that set does not name.
		await vi.waitFor(() => {
			const asked = spy.mock.calls.map((call) => String(call[0]));
			expect(asked.some((url) => url.includes('interval=1d') && url.includes('limit=365'))).toBe(
				true
			);
		});
	});

	it('marks the chosen range as pressed, not merely as coloured', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());

		// doc 12 §4.2's rule generalised: state is never carried by colour alone.
		const oneDay = screen.getByRole('button', { name: m['widget.markets.range_1d']() });
		await expect.element(oneDay).toHaveAttribute('aria-pressed', 'true');

		await screen.getByRole('button', { name: m['widget.markets.range_1m']() }).click();
		await expect.element(oneDay).toHaveAttribute('aria-pressed', 'false');
	});
});

describe('the footer', () => {
	it('carries doc 16 §4’s disclaimer, permanently rather than on a condition', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());

		await expect.element(screen.getByText(m['widget.markets.disclaimer']())).toBeInTheDocument();
	});

	it('renders the credit line the payload carries (doc 16 §5)', async () => {
		serveBoth(klinesEnvelope(40));
		const screen = render(TpMarketsDetail, props());

		// In the payload rather than in the component, so a surface cannot render
		// a price without also having been handed the credit for it.
		await expect.element(screen.getByText('Crypto data by Binance')).toBeInTheDocument();
	});
});

describe('the watchlist manager (doc 09 §1)', () => {
	function withSpy() {
		const onUpdateSettings = vi.fn();
		const screen = render(TpMarketsDetail, props({ onUpdateSettings }));
		return { screen, onUpdateSettings };
	}

	it('adds a symbol the reader types, uppercased', async () => {
		serveBoth(klinesEnvelope(40));
		const { screen, onUpdateSettings } = withSpy();

		await screen.getByLabelText(m['widget.markets.add_label']()).fill('solusdt');
		await screen.getByRole('button', { name: m['widget.markets.add_row']() }).click();

		await vi.waitFor(() => expect(onUpdateSettings).toHaveBeenCalledTimes(1));
		expect(onUpdateSettings.mock.calls[0]?.[0]).toEqual({
			watchlist: [...WATCHLIST, { kind: 'crypto', symbol: 'SOLUSDT', display: '' }]
		});
	});

	it('says which refusal it was, and writes nothing', async () => {
		serveBoth(klinesEnvelope(40));
		const { screen, onUpdateSettings } = withSpy();

		await screen.getByLabelText(m['widget.markets.add_label']()).fill('BTC/USDT');
		await screen.getByRole('button', { name: m['widget.markets.add_row']() }).click();

		await expect
			.element(screen.getByText(m['widget.markets.refused_invalid']()))
			.toBeInTheDocument();
		expect(onUpdateSettings).not.toHaveBeenCalled();
	});

	it('names the duplicate rather than refusing in general', async () => {
		serveBoth(klinesEnvelope(40));
		const { screen } = withSpy();

		await screen.getByLabelText(m['widget.markets.add_label']()).fill('BTCUSDT');
		await screen.getByRole('button', { name: m['widget.markets.add_row']() }).click();

		await expect
			.element(screen.getByText(m['widget.markets.refused_duplicate']({ symbol: 'BTCUSDT' })))
			.toBeInTheDocument();
	});

	it('removes a row by its own name', async () => {
		serveBoth(klinesEnvelope(40));
		const { screen, onUpdateSettings } = withSpy();

		await screen
			.getByRole('button', { name: m['widget.markets.remove_row']({ symbol: 'DOGEUSDT' }) })
			.click();

		await vi.waitFor(() => expect(onUpdateSettings).toHaveBeenCalledTimes(1));
		expect(onUpdateSettings.mock.calls[0]?.[0]).toEqual({ watchlist: [WATCHLIST[0]] });
	});

	it('reorders, and disables the control that would do nothing', async () => {
		serveBoth(klinesEnvelope(40));
		const { screen, onUpdateSettings } = withSpy();

		// "Up" on the first row has nothing above it, so the control is disabled
		// rather than silently doing nothing when pressed.
		await expect
			.element(
				screen.getByRole('button', { name: m['widget.markets.move_up']({ symbol: 'BTCUSDT' }) })
			)
			.toBeDisabled();

		await screen
			.getByRole('button', { name: m['widget.markets.move_down']({ symbol: 'BTCUSDT' }) })
			.click();

		await vi.waitFor(() => expect(onUpdateSettings).toHaveBeenCalledTimes(1));
		expect(onUpdateSettings.mock.calls[0]?.[0]).toEqual({
			watchlist: [WATCHLIST[1], WATCHLIST[0]]
		});
	});

	it('offers the static top-list minus what is already held (doc 09 §1)', async () => {
		serveBoth(klinesEnvelope(40));
		const { screen } = withSpy();

		const options = [...screen.container.querySelectorAll('datalist option')].map(
			(node) => (node as HTMLOptionElement).value
		);

		expect(options).toContain('SOLUSDT');
		// Both already on the watchlist.
		expect(options).not.toContain('BTCUSDT');
		expect(options).not.toContain('DOGEUSDT');
	});
});
