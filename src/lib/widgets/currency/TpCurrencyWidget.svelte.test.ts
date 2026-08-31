import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { TpApiMeta } from '$lib/api-types';
import { FX_OK, FX_PAYLOAD, FX_STALE } from '$lib/core/__fixtures__/fx';
import { scheduler } from '$lib/core/scheduler';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { swrCache } from '$lib/core/swr.svelte';
import { tileStatus, tileStatusChannel } from '$lib/core/tile-status';
import type { TpTileSize } from '$lib/core/types';
import { fmtCurrency } from '$lib/i18n/fmt';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { fxKey } from './service';
import TpCurrencyWidget from './TpCurrencyWidget.svelte';

/**
 * The currency tile, in the browser project.
 *
 * Same three things held still as the weather tile: the clock, `fetch`, and a
 * throwaway Dexie per case. Message assertions go through `m[...]()` rather
 * than through a literal, because `settings.locale` and Paraglide's locale are
 * separate in a component test.
 */

/** 2026-08-31T10:00Z, the instant `__fixtures__/fx.ts` was recorded near. */
const NOW = new Date(Date.UTC(2026, 7, 31, 10, 0));

const S: TpTileSize = { w: 2, h: 1, pxW: 160, pxH: 48, tier: 'S' };
const M: TpTileSize = { w: 3, h: 2, pxW: 320, pxH: 120, tier: 'M' };
const L: TpTileSize = { w: 4, h: 4, pxW: 440, pxH: 300, tier: 'L' };

const FRESH_META: TpApiMeta = { cachedAt: 1_788_134_551, source: 'er-api', stale: false };

let db: TpDb;

function props(over: Record<string, unknown> = {}) {
	return { instanceId: 'wgt_fx', settings: {}, size: M, db, ...over };
}

/** Resolves every `/api/fx` call with one envelope. */
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
	db = createDb(`tilepier-fx-${crypto.randomUUID()}`);
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

describe('the conversion', () => {
	it('renders the pair the reader is set to, rounded the way that money is written', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props({ settings: { base: 'USD', quote: 'VND' } }));

		// doc 08 §2: display rounding per currency minor units, and VND has none.
		await expect
			.element(screen.getByTestId('currency-hero'))
			.toHaveTextContent(fmtCurrency(FX_PAYLOAD.rates['VND'] as number, 'VND', settings.locale));
	});

	it('multiplies by the amount in the settings bag', async () => {
		serve(FX_OK);
		const screen = render(
			TpCurrencyWidget,
			props({ settings: { base: 'USD', quote: 'VND', amount: 3 } })
		);

		await expect
			.element(screen.getByTestId('currency-hero'))
			.toHaveTextContent(
				fmtCurrency(3 * (FX_PAYLOAD.rates['VND'] as number), 'VND', settings.locale)
			);
	});

	it('shows the rate it used, so the number is checkable', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByTestId('currency-rate')).toBeInTheDocument();
	});
});

describe('states (doc 06 §3)', () => {
	it('loading: a skeleton, never a spinner inside a tile', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByLabelText(m['widget.currency.loading']())).toBeInTheDocument();
	});

	it('offline: an offline card when there is nothing cached, not a badge on an empty box', async () => {
		serveNetworkFailure();
		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByTestId('currency-offline')).toBeInTheDocument();
		expect(tileStatus('wgt_fx')).toBeUndefined();
	});

	it('error: one sentence and a retry, and the tile never blanks', async () => {
		serve({ ok: false, error: { code: 'UPSTREAM_DOWN' } }, { status: 503 });
		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByTestId('currency-error')).toBeInTheDocument();
		await expect.element(screen.getByText(m['common.retry']())).toBeInTheDocument();
	});

	it('rate-limited: says so rather than showing the generic failure', async () => {
		serve({ ok: false, error: { code: 'RATE_LIMITED', retryAfterS: 30 } }, { status: 429 });
		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByText(m['widget.currency.rate_limited']())).toBeInTheDocument();
	});

	it('empty: a table arrived and does not quote this pair', async () => {
		// doc 08 §2's edge case, and this widget's `empty`: `ZWL` is in the
		// fixture's yesterday and not in its today, which is exactly what an
		// upstream dropping a currency looks like from a saved settings bag.
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props({ settings: { base: 'USD', quote: 'ZWL' } }));

		await expect
			.element(screen.getByTestId('currency-unquoted'))
			.toHaveTextContent(m['widget.currency.unavailable']({ code: 'ZWL' }));
	});

	it('stale: the Worker’s own stale flag reaches the host badge', async () => {
		// The case `T = { payload, meta }` exists for. `swr` would call this
		// `fresh` — it was cached a moment ago — but the Worker served it past its
		// KV TTL because ER-API was down (doc 11 §4).
		serve(FX_STALE);
		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByTestId('currency-hero')).toBeInTheDocument();
		await vi.waitFor(() => expect(tileStatus('wgt_fx')?.kind).toBe('stale'));
	});

	it('ready: a fresh serve carries no badge at all', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByTestId('currency-hero')).toBeInTheDocument();
		expect(tileStatus('wgt_fx')).toBeUndefined();
	});

	it('degrades to a badge over real rates when the network is gone', async () => {
		// doc 17 §3's cached-data contract: last payload plus a badge, not a blank
		// tile and not an offline card.
		await db.apiCache.put({
			key: fxKey(),
			payload: { payload: FX_PAYLOAD, meta: FRESH_META },
			// Older than the 12 h client TTL, so it revalidates and fails.
			cachedAt: NOW.getTime() - 13 * 60 * 60 * 1000
		});
		serveNetworkFailure();

		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByTestId('currency-hero')).toBeInTheDocument();
		await vi.waitFor(() => expect(tileStatus('wgt_fx')?.kind).toBe('offline'));
	});

	it('permission-needed is forbidden, not merely absent', async () => {
		// doc 06 §3: the state is required exactly when the manifest declares a
		// `permissions` entry, and forbidden otherwise. Asserted against the
		// manifest so it stays true if someone adds one without reading this.
		const manifest = (await import('./manifest')).default;
		expect(manifest.permissions).toBeUndefined();
	});

	it('takes its badge with it when the tile is removed', async () => {
		serve(FX_STALE);
		const screen = render(TpCurrencyWidget, props());
		await expect.element(screen.getByTestId('currency-hero')).toBeInTheDocument();
		await vi.waitFor(() => expect(tileStatusChannel.size).toBe(1));

		cleanup();

		expect(tileStatusChannel.size).toBe(0);
	});
});

describe('density (doc 13 §3, doc 08 §3)', () => {
	it('at h=1 says the whole sentence on one line, and offers no controls', async () => {
		// ~34 px of body. A bare number there would be a quantity with no unit
		// attached to it, so the line carries the pair instead — and the pickers,
		// the input and the attribution link are all gone.
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props({ size: S }));

		await expect.element(screen.getByTestId('currency-hero')).toHaveTextContent('USD');
		await expect.element(screen.getByTestId('currency-amount')).not.toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-swap')).not.toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-credit')).not.toBeInTheDocument();
	});

	it('keeps the attribution reachable at h=1 through the title', async () => {
		// doc 16 §5 asks for a visible link wherever rates are shown, and there is
		// no room for one here. Recorded as a deviation in doc 08 §2; this is the
		// mitigation, and it has to actually be there.
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props({ size: S }));

		await expect.element(screen.getByTestId('currency-hero')).toBeInTheDocument();
		const hero = screen.container.querySelector('[data-testid="currency-hero"]') as HTMLElement;
		expect(hero.title).toBe(FX_PAYLOAD.attribution);
	});

	it('at h≥2 offers the pair, the amount and a real attribution link', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props({ size: M }));

		await expect.element(screen.getByTestId('currency-amount')).toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-base')).toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-quote')).toBeInTheDocument();

		const credit = screen.container.querySelector(
			'[data-testid="currency-credit"]'
		) as HTMLAnchorElement;
		expect(credit.getAttribute('href')).toContain('exchangerate-api.com');
		expect(credit.getAttribute('rel')).toContain('noopener');
	});

	it('at tier L renders the same controls, because nothing is gated on width', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props({ size: L }));

		await expect.element(screen.getByTestId('currency-amount')).toBeInTheDocument();
		await expect.element(screen.getByTestId('currency-credit')).toBeInTheDocument();
	});
});

describe('editing the pair (doc 06 §2)', () => {
	it('swaps base and quote in one write', async () => {
		serve(FX_OK);
		const onUpdateSettings = vi.fn();
		const screen = render(
			TpCurrencyWidget,
			props({ settings: { base: 'USD', quote: 'VND' }, onUpdateSettings })
		);

		await expect.element(screen.getByTestId('currency-swap')).toBeInTheDocument();
		await screen.getByTestId('currency-swap').click();

		await vi.waitFor(() =>
			expect(onUpdateSettings).toHaveBeenCalledWith({ base: 'VND', quote: 'USD' })
		);
	});

	it('persists an amount the reader typed', async () => {
		serve(FX_OK);
		const onUpdateSettings = vi.fn();
		const screen = render(TpCurrencyWidget, props({ onUpdateSettings }));

		await expect.element(screen.getByTestId('currency-amount')).toBeInTheDocument();
		await screen.getByTestId('currency-amount').fill('250');

		await vi.waitFor(() => expect(onUpdateSettings).toHaveBeenCalledWith({ amount: 250 }));
	});

	it('writes nothing while the field is empty', async () => {
		// A cleared input is a reader mid-keystroke, not a settings change. Writing
		// `NaN` into `tp.layout.v1` would make `readSettings` fail closed on the
		// next mount and silently reset the pair as well as the amount.
		serve(FX_OK);
		const onUpdateSettings = vi.fn();
		const screen = render(TpCurrencyWidget, props({ onUpdateSettings }));

		await expect.element(screen.getByTestId('currency-amount')).toBeInTheDocument();
		await screen.getByTestId('currency-amount').fill('');

		await vi.waitFor(() => expect(onUpdateSettings).not.toHaveBeenCalled());
	});

	it('offers a code upstream dropped, so the reader can leave it', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props({ settings: { base: 'USD', quote: 'VND' } }));

		await expect.element(screen.getByTestId('currency-quote')).toBeInTheDocument();
		const quote = screen.container.querySelector(
			'[data-testid="currency-quote"]'
		) as unknown as HTMLSelectElement;
		const codes = [...quote.options].map((o) => o.value);

		expect(codes).toContain('VND');
		expect(codes).toEqual([...codes].sort());
	});
});

describe('the scheduler wiring (doc 04 §3)', () => {
	it('registers under the data key, not the instance', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props());

		await expect.element(screen.getByTestId('currency-hero')).toBeInTheDocument();
		expect(scheduler.inspect().map((task) => task.id)).toContain(fxKey());
	});

	it('leaves nothing behind when the tile is removed', async () => {
		serve(FX_OK);
		const screen = render(TpCurrencyWidget, props());
		await expect.element(screen.getByTestId('currency-hero')).toBeInTheDocument();

		cleanup();

		expect(scheduler.size).toBe(0);
		expect(swrCache.size).toBe(0);
	});
});
