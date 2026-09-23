import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { CRYPTO_OK } from '$lib/core/__fixtures__/crypto';
import { STOCK_OK } from '$lib/core/__fixtures__/stock';
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

	/**
	 * 1M and 1Y are both daily candles, so they share one data key (doc 11 §4)
	 * — and until 2026-09-23 they shared it with different depths. Whichever
	 * range was opened second read the first one's window out of `apiCache` as
	 * fresh and drew it under its own label: a year of candles captioned 1M, or
	 * a month captioned 1Y, for as long as the entry stayed fresh.
	 *
	 * The endpoint answers the last `limit` candles of one deep series, so the
	 * stub does the same thing rather than handing back `limit` fresh ones.
	 */
	describe('two ranges over one interval', () => {
		const DEEP = 400;

		function serveWindows(): void {
			vi.stubGlobal(
				'fetch',
				vi.fn(async (input: string) => {
					const url = new URL(String(input), 'https://tilepier.test');
					if (url.pathname !== '/api/crypto/klines') {
						return new Response(JSON.stringify(CRYPTO_OK), {
							headers: { 'content-type': 'application/json' }
						});
					}
					const limit = Number(url.searchParams.get('limit'));
					const body = {
						ok: true,
						data: {
							symbol: 'BTCUSDT',
							interval: url.searchParams.get('interval'),
							candles: candles(DEEP).slice(-limit),
							attribution: 'Crypto data by Binance'
						},
						meta: { cachedAt: 1_788_220_800, source: 'binance', stale: false }
					};
					return new Response(JSON.stringify(body), {
						headers: { 'content-type': 'application/json' }
					});
				})
			);
		}

		/** Candle `i` opens at `100 + i` and its low is `95 + i`. */
		function opensAt(i: number): string {
			return `${String(100 + i)}.00`;
		}

		async function caption(screen: ReturnType<typeof render>, range: string): Promise<string> {
			await vi.waitFor(() => {
				const node = screen.container.querySelector('[data-testid="chart-summary"]');
				expect(node?.textContent).toContain(` ${range}:`);
			});
			const node = screen.container.querySelector('[data-testid="chart-summary"]');
			return node?.textContent ?? '';
		}

		it('draws a month under 1M after a year was drawn under 1Y', async () => {
			serveWindows();
			const screen = render(TpMarketsDetail, props());
			await expect.element(screen.getByTestId('chart-canvas')).toBeInTheDocument();

			await screen.getByRole('button', { name: m['widget.markets.range_1y']() }).click();
			expect(await caption(screen, m['widget.markets.range_1y']())).toContain(opensAt(DEEP - 365));

			await screen.getByRole('button', { name: m['widget.markets.range_1m']() }).click();
			expect(await caption(screen, m['widget.markets.range_1m']())).toContain(opensAt(DEEP - 30));
		});

		it('draws a year under 1Y after a month was drawn under 1M', async () => {
			serveWindows();
			const screen = render(TpMarketsDetail, props());
			await expect.element(screen.getByTestId('chart-canvas')).toBeInTheDocument();

			await screen.getByRole('button', { name: m['widget.markets.range_1m']() }).click();
			expect(await caption(screen, m['widget.markets.range_1m']())).toContain(opensAt(DEEP - 30));

			await screen.getByRole('button', { name: m['widget.markets.range_1y']() }).click();
			expect(await caption(screen, m['widget.markets.range_1y']())).toContain(opensAt(DEEP - 365));
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

/**
 * The stock half of the detail, from Week 5b. The routes answer by URL, the
 * way the Worker does, because most of what is asserted here is *which*
 * question the panel asked.
 */
describe('stocks in the detail (doc 09 §1)', () => {
	const STOCK_FIRST = [
		{ kind: 'stock', symbol: 'AAPL', display: '' },
		{ kind: 'crypto', symbol: 'BTCUSDT', display: 'BTC' }
	];

	type Route = (url: URL) => Response | Promise<Response>;

	function reply(body: unknown, status = 200): Response {
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	}

	const QUOTA = { ok: false, error: { code: 'QUOTA_EXHAUSTED' } };

	function series(url: URL, count: number): Response {
		return reply({
			ok: true,
			data: {
				symbol: url.searchParams.get('symbol'),
				interval: url.searchParams.get('interval'),
				candles: candles(count),
				attribution: 'Stock charts by Twelve Data'
			},
			meta: { cachedAt: 1_788_220_800, source: 'twelvedata', stale: false }
		});
	}

	function search(results: { symbol: string; name: string }[]): Route {
		return (url) =>
			reply({
				ok: true,
				data: { query: url.searchParams.get('q'), results, attribution: 'Search by Finnhub' },
				meta: { cachedAt: 1_788_220_800, source: 'finnhub', stale: false }
			});
	}

	function serveRoutes(routes: Record<string, Route>): ReturnType<typeof vi.fn> {
		const all: Record<string, Route> = {
			'/api/crypto/ticker': () => reply(CRYPTO_OK),
			'/api/stock/quote': () => reply(STOCK_OK),
			'/api/stock/series': (url) => series(url, 40),
			'/api/crypto/klines': () => reply(klinesEnvelope(40)),
			...routes
		};
		const spy = vi.fn(async (input: string) => {
			const url = new URL(String(input), 'https://tilepier.test');
			const route = all[url.pathname];
			return route ? route(url) : reply({ ok: false, error: { code: 'BAD_REQUEST' } }, 404);
		});
		vi.stubGlobal('fetch', spy);
		return spy;
	}

	function asked(spy: ReturnType<typeof vi.fn>, path: string): URL[] {
		return spy.mock.calls
			.map((call) => new URL(String(call[0]), 'https://tilepier.test'))
			.filter((url) => url.pathname === path);
	}

	function stockProps(over: Record<string, unknown> = {}) {
		return props({ settings: { watchlist: STOCK_FIRST }, ...over });
	}

	it('heads a stock with its price, its day move and its day band', async () => {
		serveRoutes({});
		const screen = render(TpMarketsDetail, stockProps());

		await expect.element(screen.getByRole('heading', { name: 'AAPL' })).toBeInTheDocument();
		await expect.element(screen.getByText('227.52')).toBeInTheDocument();
		await expect.element(screen.getByText('+0.41%')).toBeInTheDocument();
		await expect
			.element(screen.getByText(m['widget.markets.day_band']({ low: '225.10', high: '228.40' })))
			.toBeInTheDocument();
	});

	it('picks by kind and symbol, not by symbol alone', async () => {
		serveRoutes({});
		const screen = render(TpMarketsDetail, stockProps());

		const values = [...screen.container.querySelectorAll('select option')].map(
			(node) => (node as HTMLOptionElement).value
		);
		expect(values).toContain('stock:AAPL');
		expect(values).toContain('crypto:BTCUSDT');

		await screen
			.getByLabelText(m['widget.markets.symbol_label'](), { exact: true })
			.selectOptions('crypto:BTCUSDT');
		await expect.element(screen.getByRole('heading', { name: 'BTC' })).toBeInTheDocument();
	});

	it('asks for the deep daily series whichever daily range is picked', async () => {
		const spy = serveRoutes({});
		const screen = render(TpMarketsDetail, stockProps());
		await expect.element(screen.getByTestId('chart-canvas')).toBeInTheDocument();

		// 1D is the only fifteen-minute range, so it is its own deepest window.
		expect(asked(spy, '/api/stock/series')[0]?.search).toBe('?symbol=AAPL&interval=15min&limit=26');

		await screen.getByRole('button', { name: m['widget.markets.range_1w']() }).click();

		// 1W, 1M and 1Y share one daily key, so each asks for the year and windows
		// it — the key names one response again (see "two ranges over one interval").
		await vi.waitFor(() => {
			const daily = asked(spy, '/api/stock/series').filter(
				(url) => url.searchParams.get('interval') === '1day'
			);
			expect(daily.map((url) => url.searchParams.get('limit'))).toEqual(['252']);
		});
	});

	it('collapses 1D to the week, with a note, when intraday is refused', async () => {
		serveRoutes({
			'/api/stock/series': (url) =>
				url.searchParams.get('interval') === '15min' ? reply(QUOTA, 503) : series(url, 252)
		});
		const screen = render(TpMarketsDetail, stockProps());

		await expect
			.element(screen.getByText(m['widget.markets.intraday_paused']()))
			.toBeInTheDocument();
		await expect.element(screen.getByTestId('chart-canvas')).toBeInTheDocument();
		// The caption names what is drawn; the picker keeps what the reader chose.
		await vi.waitFor(() => {
			const caption = screen.container.querySelector('[data-testid="chart-summary"]');
			expect(caption?.textContent).toContain(` ${m['widget.markets.range_1w']()}:`);
		});
		await expect
			.element(screen.getByRole('button', { name: m['widget.markets.range_1d']() }))
			.toHaveAttribute('aria-pressed', 'true');
	});

	it('says the allowance is spent when the week is refused too', async () => {
		serveRoutes({ '/api/stock/series': () => reply(QUOTA, 503) });
		const screen = render(TpMarketsDetail, stockProps());

		await expect.element(screen.getByText(m['widget.markets.quota_note']())).toBeInTheDocument();
		// The price still stands: this is the quote-only rung, not an error.
		await expect.element(screen.getByText('227.52')).toBeInTheDocument();
	});

	it('draws the quote-only view for a symbol Twelve Data does not cover', async () => {
		serveRoutes({ '/api/stock/series': (url) => series(url, 0) });
		const screen = render(TpMarketsDetail, stockProps());

		await expect
			.element(screen.getByText(m['widget.markets.quote_only']({ symbol: 'AAPL' })))
			.toBeInTheDocument();
		await expect.element(screen.getByTestId('chart-canvas')).not.toBeInTheDocument();
	});

	it('carries the stock footnote and credits both upstreams (doc 16 §5)', async () => {
		serveRoutes({});
		const screen = render(TpMarketsDetail, stockProps());

		await expect.element(screen.getByText(m['widget.markets.stock_note']())).toBeInTheDocument();
		await expect.element(screen.getByText('Stock quotes by Finnhub')).toBeInTheDocument();
		await expect.element(screen.getByText('Stock charts by Twelve Data')).toBeInTheDocument();
	});

	it('says when a stock is quoted from the close', async () => {
		serveRoutes({});
		const screen = render(TpMarketsDetail, stockProps());

		await expect
			.element(screen.getByText(m['widget.markets.at_close_hint']({ age: '4 hours ago' })))
			.toBeInTheDocument();
	});

	describe('search-add', () => {
		const APPLE = [
			{ symbol: 'AAPL', name: 'APPLE INC' },
			{ symbol: 'APLE', name: 'APPLE HOSPITALITY REIT INC' }
		];

		async function searchFor(screen: ReturnType<typeof render>, text: string): Promise<void> {
			await screen.getByLabelText(m['widget.markets.kind_label']()).selectOptions('stock');
			await screen.getByLabelText(m['widget.markets.add_label_stock']()).fill(text);
		}

		it('searches after a pause, in lower case, and adds the pick', async () => {
			const spy = serveRoutes({ '/api/stock/search': search(APPLE) });
			const onUpdateSettings = vi.fn();
			const screen = render(TpMarketsDetail, props({ onUpdateSettings }));

			await searchFor(screen, 'Apple');
			await screen
				.getByRole('button', {
					name: m['widget.markets.search_add']({ symbol: 'AAPL', name: 'APPLE INC' })
				})
				.click();

			expect(asked(spy, '/api/stock/search').map((url) => url.search)).toEqual(['?q=apple']);
			expect(onUpdateSettings).toHaveBeenCalledWith({
				watchlist: [...WATCHLIST, { kind: 'stock', symbol: 'AAPL', display: '' }]
			});
		});

		it('will not add a result the watchlist already holds', async () => {
			serveRoutes({ '/api/stock/search': search(APPLE) });
			const screen = render(TpMarketsDetail, stockProps());

			await searchFor(screen, 'apple');

			await expect
				.element(
					screen.getByRole('button', {
						name: m['widget.markets.refused_duplicate']({ symbol: 'AAPL' })
					})
				)
				.toBeDisabled();
		});

		it('says so when there is no match, and when search cannot answer', async () => {
			serveRoutes({ '/api/stock/search': search([]) });
			const empty = render(TpMarketsDetail, props());
			await searchFor(empty, 'zzzz');
			await expect
				.element(empty.getByText(m['widget.markets.search_empty']({ query: 'zzzz' })))
				.toBeInTheDocument();
			empty.unmount();

			serveRoutes({
				'/api/stock/search': () => reply({ ok: false, error: { code: 'UPSTREAM_DOWN' } }, 503)
			});
			const down = render(TpMarketsDetail, props());
			await searchFor(down, 'apple');
			await expect.element(down.getByText(m['widget.markets.search_failed']())).toBeInTheDocument();
		});

		it('never searches while a coin is being added', async () => {
			const spy = serveRoutes({ '/api/stock/search': search(APPLE) });
			const screen = render(TpMarketsDetail, props());

			await screen.getByLabelText(m['widget.markets.add_label']()).fill('apple');
			await new Promise((resolve) => setTimeout(resolve, 700));

			// The coin list is the bundled one (doc 09 §1); asking Finnhub about it
			// would spend a call on an answer the picker cannot use.
			expect(asked(spy, '/api/stock/search')).toEqual([]);
		});
	});
});
