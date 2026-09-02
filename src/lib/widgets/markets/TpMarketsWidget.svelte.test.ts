import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { CRYPTO_OK, CRYPTO_PAYLOAD, CRYPTO_STALE } from '$lib/core/__fixtures__/crypto';
import manifest from './manifest';
import { scheduler } from '$lib/core/scheduler';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { swrCache } from '$lib/core/swr.svelte';
import { tileStatus, tileStatusChannel } from '$lib/core/tile-status';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { klinesKey, SPARK_MAX_AGE_MS, tickerKey } from './service';
import TpMarketsWidget from './TpMarketsWidget.svelte';

/**
 * The markets tile, in the browser project.
 *
 * Same three things held still as the weather and currency tiles: the clock,
 * `fetch`, and a throwaway Dexie per case. Message assertions go through
 * `m[...]()` rather than through a literal, because `settings.locale` and
 * Paraglide's locale are separate in a component test.
 */

/** 2026-09-01T00:00Z, the instant `__fixtures__/crypto.ts` was recorded at. */
const NOW = new Date(Date.UTC(2026, 8, 1, 0, 0));

const M: TpTileSize = { w: 3, h: 3, pxW: 320, pxH: 220, tier: 'M' };
/** Two columns, which is below doc 09 §1's `w >= 3` sparkline threshold. */
const NARROW: TpTileSize = { w: 2, h: 3, pxW: 200, pxH: 220, tier: 'M' };
const L: TpTileSize = { w: 4, h: 4, pxW: 440, pxH: 300, tier: 'L' };

const WATCHLIST = [
	{ kind: 'crypto', symbol: 'BTCUSDT', display: 'BTC' },
	{ kind: 'crypto', symbol: 'DOGEUSDT', display: '' },
	{ kind: 'crypto', symbol: 'GONEUSDT', display: '' }
];

let db: TpDb;

function props(over: Record<string, unknown> = {}) {
	return { instanceId: 'wgt_mk', settings: { watchlist: WATCHLIST }, size: M, db, ...over };
}

function serve(body: unknown, init: ResponseInit = {}): ReturnType<typeof vi.fn> {
	const spy = vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				...init,
				headers: { 'content-type': 'application/json' }
			})
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

/** A network that is simply not there — doc 17 §4's `TypeError` path. */
function serveNetworkFailure(): ReturnType<typeof vi.fn> {
	const spy = vi.fn(async () => {
		await Promise.resolve();
		throw new TypeError('Failed to fetch');
	});
	vi.stubGlobal('fetch', spy);
	return spy;
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
	db = createDb(`tilepier-mk-${crypto.randomUUID()}`);
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

describe('the watchlist rows', () => {
	it('renders one row per entry, in the reader order and under the reader labels', async () => {
		serve(CRYPTO_OK);
		const screen = render(TpMarketsWidget, props());

		await expect.element(screen.getByText('BTC')).toBeInTheDocument();
		// Never renamed, so the row is labelled by its symbol.
		await expect.element(screen.getByText('DOGEUSDT')).toBeInTheDocument();
	});

	it('gives a sub-dollar coin more decimals than a five-figure one (doc 09 §1)', async () => {
		serve(CRYPTO_OK);
		const screen = render(TpMarketsWidget, props());

		// 62,910.53 at two places; 0.2143 at four. A single precision would either
		// drop the cents off bitcoin or round dogecoin to 0.21.
		await expect.element(screen.getByText('62,910.53')).toBeInTheDocument();
		await expect.element(screen.getByText('0.2143')).toBeInTheDocument();
	});

	it('signs the change before it colours it (doc 12 §4.2)', async () => {
		serve(CRYPTO_OK);
		const screen = render(TpMarketsWidget, props());

		// Colour is never the only channel: `Intl` places the sign, and the class
		// is reinforcement. A reader with deuteranopia reads the glyph.
		const up = screen.getByText('+2.13%');
		await expect.element(up).toBeInTheDocument();
		await expect.element(screen.getByText('-1.54%')).toBeInTheDocument();
	});

	it('marks a symbol upstream had nothing for, and keeps the row', async () => {
		serve(CRYPTO_OK);
		const screen = render(TpMarketsWidget, props());

		// doc 09 §1's delisted case. The row stays so the reader can find and
		// remove it; dropping it would make a coin disappear with no explanation.
		await expect.element(screen.getByText(m['widget.markets.unavailable']())).toBeInTheDocument();
		await expect.element(screen.getByText('GONEUSDT')).toBeInTheDocument();
	});

	it('shows the age line only where there is room for it', async () => {
		serve(CRYPTO_OK);
		const large = render(TpMarketsWidget, props({ size: L }));

		await expect
			.element(large.getByText(m['widget.markets.as_of']({ age: 'now' }), { exact: false }))
			.toBeInTheDocument();
	});
});

describe('states (doc 06 §3)', () => {
	it('renders a skeleton bar per watched row rather than a spinner', async () => {
		// Never resolves, so the tile stays in `loading`.
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		);
		const screen = render(TpMarketsWidget, props());

		await expect.element(screen.getByLabelText(m['widget.markets.loading']())).toBeInTheDocument();
	});

	it('renders the empty state, with one action, when the watchlist is empty', async () => {
		serve(CRYPTO_OK);
		const screen = render(
			TpMarketsWidget,
			props({ settings: { watchlist: [] }, onOpenDetail: () => undefined })
		);

		await expect.element(screen.getByText(m['widget.markets.no_rows']())).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: m['widget.markets.no_rows_hint']() }))
			.toBeInTheDocument();
	});

	it('states the action rather than offering it when there is no tile to open', async () => {
		// The `/w/[id]` direct load has no host to hand down `onOpenDetail`, and a
		// button that cannot do anything is worse than a sentence.
		serve(CRYPTO_OK);
		const screen = render(TpMarketsWidget, props({ settings: { watchlist: [] } }));

		await expect.element(screen.getByText(m['widget.markets.no_rows_hint']())).toBeInTheDocument();
		expect(screen.container.querySelector('button')).toBeNull();
	});

	it('asks for nothing at all when there is nothing to ask about', async () => {
		const spy = serve(CRYPTO_OK);
		render(TpMarketsWidget, props({ settings: { watchlist: [] } }));

		// `?symbols=` would be a `BAD_REQUEST` once a minute, forever, for an
		// answer nobody asked for.
		await vi.waitFor(() => expect(spy).not.toHaveBeenCalled());
	});

	it('renders an inline error with a retry, never a blank tile', async () => {
		serve({ ok: false, error: { code: 'UPSTREAM_DOWN' } }, { status: 503 });
		const screen = render(TpMarketsWidget, props());

		await expect.element(screen.getByText(m['widget.markets.error']())).toBeInTheDocument();
		await expect.element(screen.getByRole('button', { name: m['common.retry']() })).toBeVisible();
	});

	it('says so plainly when there is no network and nothing saved', async () => {
		serveNetworkFailure();
		const screen = render(TpMarketsWidget, props());

		await expect.element(screen.getByText(m['widget.markets.offline']())).toBeInTheDocument();
	});
});

describe('the host badge (doc 13 §7)', () => {
	it('raises a stale badge for a payload the Worker served past its own TTL', async () => {
		// `swr` computes staleness from the client's cache age alone, so this
		// arrives looking fresh — `meta.stale` is the only thing that says
		// otherwise (doc 04 §2).
		serve(CRYPTO_STALE);
		render(TpMarketsWidget, props());

		await vi.waitFor(() => expect(tileStatus('wgt_mk')?.kind).toBe('stale'));
	});

	it('raises stale-error with a retry when a refusal lands on cached prices', async () => {
		/*
		 * Driven through the *hydrate* path rather than through a scheduler tick,
		 * which is both more faithful and the only version that works here: this
		 * is a reload while rate-limited, and `scheduler.tick` returns immediately
		 * when `document.visibilityState` is `hidden` — which is what a headless
		 * browser can report for an iframe nobody is looking at.
		 *
		 * Aged past the 30 s client TTL, so `swr` hydrates from Dexie, emits the
		 * cached prices, and then revalidates into the refusal.
		 */
		await db.apiCache.put({
			key: tickerKey(['BTCUSDT', 'DOGEUSDT', 'GONEUSDT']),
			cachedAt: NOW.getTime() - 60_000,
			payload: { payload: CRYPTO_PAYLOAD, meta: { cachedAt: 1, source: 'binance', stale: false } }
		});
		serve({ ok: false, error: { code: 'RATE_LIMITED' } }, { status: 429 });

		const screen = render(TpMarketsWidget, props());

		// The prices are still on screen — that is the whole point of the state.
		await expect.element(screen.getByText('62,910.53')).toBeInTheDocument();

		// doc 04 §2 maps `rate-limited` to `stale-error`, and doc 13 §7 gives that
		// one a retry. A tile holding cached prices through a 429 showed no badge
		// at all until the channel moved into the host header (doc 23 §Week 4b).
		await vi.waitFor(() => expect(tileStatus('wgt_mk')?.kind).toBe('stale-error'));
		expect(tileStatus('wgt_mk')?.retry).toBeTypeOf('function');
	});

	it('clears its badge when the tile goes away', async () => {
		serve(CRYPTO_STALE);
		const screen = render(TpMarketsWidget, props());
		await vi.waitFor(() => expect(tileStatus('wgt_mk')?.kind).toBe('stale'));

		screen.unmount();
		// A channel that grew with every tile ever mounted would be a leak nothing
		// else can see (`core/tile-status.ts`).
		expect(tileStatus('wgt_mk')).toBeUndefined();
		expect(tileStatusChannel.size).toBe(0);
	});
});

describe('the manifest contract', () => {
	it('declares no permissions, which is what forbids `permission-needed`', () => {
		// doc 06 §3 makes the state required exactly when a manifest declares one,
		// and forbidden otherwise. Asserted against the manifest so it stays true
		// if someone adds a permission without reading the component comment.
		expect(manifest.permissions).toBeUndefined();
	});

	it('is the registry row that carries visibleOnly (doc 06 §7)', () => {
		expect(manifest.refresh).toEqual({ kind: 'interval', everyMs: 60_000, visibleOnly: true });
	});

	it('registers exactly one scheduler entry, under the instance', async () => {
		serve(CRYPTO_OK);
		render(TpMarketsWidget, props());

		// The id is the instanceId rather than the data key, which is what lets
		// the cadence outlive a watchlist edit — the data key moves with the set.
		await vi.waitFor(() => expect(scheduler.size).toBe(1));
		expect(scheduler.inspect()[0]?.id).toBe('wgt_mk');
	});
});

/**
 * doc 09 §1's micro-sparkline.
 *
 * The case that matters is the one about *not* fetching: doc 11 §5 keeps series
 * out of the tile's request path entirely, and that is what makes the Twelve
 * Data quota model hold in 5b. A tile that subscribed through `swr()` would
 * revalidate on its own 60 s cadence, once per watched symbol.
 */
describe('the sparkline (doc 09 §1)', () => {
	/** Puts candles where the tile can peek at them, without ever having asked
	 *  for them — which is what opening the detail once would have done. */
	async function cacheCandles(symbol: string, ageMs = 0): Promise<void> {
		await db.apiCache.put({
			key: klinesKey(symbol, '5m'),
			cachedAt: NOW.getTime() - ageMs,
			payload: {
				payload: {
					symbol,
					interval: '5m',
					candles: Array.from({ length: 60 }, (_, i) => [i, 100, 110 + i, 90, 100 + i, 1]),
					attribution: 'Crypto data by Binance'
				},
				meta: { cachedAt: 1, source: 'binance', stale: false }
			}
		});
	}

	it('draws one for a symbol whose candles are already on the device', async () => {
		serve(CRYPTO_OK);
		await cacheCandles('BTCUSDT');

		const screen = render(TpMarketsWidget, props());

		await vi.waitFor(() => expect(screen.container.querySelectorAll('polyline')).toHaveLength(1));
	});

	it('never asks the network for candles', async () => {
		const spy = serve(CRYPTO_OK);
		await cacheCandles('BTCUSDT');

		const screen = render(TpMarketsWidget, props());
		await vi.waitFor(() => expect(screen.container.querySelector('polyline')).not.toBeNull());

		// The whole quota model rests on this: the tile reads the series cache and
		// never fills it (doc 11 §5).
		const asked = spy.mock.calls.map((call) => String(call[0]));
		expect(asked.every((url) => url.includes('/api/crypto/ticker'))).toBe(true);
		expect(asked.some((url) => url.includes('/api/crypto/klines'))).toBe(false);
	});

	it('renders the row without one when nothing is cached', async () => {
		serve(CRYPTO_OK);
		const screen = render(TpMarketsWidget, props());

		// Absent is an ordinary state, not a fault: a reader who has never opened
		// this symbol's detail has no candles on the device.
		await expect.element(screen.getByText('62,910.53')).toBeInTheDocument();
		expect(screen.container.querySelector('polyline')).toBeNull();
	});

	it('refuses a shape older than the price it sits beside', async () => {
		serve(CRYPTO_OK);
		await cacheCandles('BTCUSDT', SPARK_MAX_AGE_MS + 60_000);

		const screen = render(TpMarketsWidget, props());

		// `swr`'s own ceiling is seven days, which is right for a payload that
		// *is* the reading and wrong for one sitting under a live price.
		await expect.element(screen.getByText('62,910.53')).toBeInTheDocument();
		expect(screen.container.querySelector('polyline')).toBeNull();
	});

	it('leaves it out below the documented width', async () => {
		serve(CRYPTO_OK);
		await cacheCandles('BTCUSDT');

		const screen = render(TpMarketsWidget, props({ size: NARROW }));

		await expect.element(screen.getByText('62,910.53')).toBeInTheDocument();
		expect(screen.container.querySelector('polyline')).toBeNull();
	});
});
