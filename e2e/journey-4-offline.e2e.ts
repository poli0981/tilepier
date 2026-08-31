import { expect, test, type Page } from '@playwright/test';
import { SEEDED_TILES } from './_lib/seed';

/**
 * doc 19 §4 journey #4: "Offline emulation: toggle offline → stale badges
 * appear → tier-1 widgets still work → online → refresh clears badges."
 *
 * **Complete since 2026-08-31.** The first three quarters were written in
 * Week 3 against a deck of purely local widgets, and that is not a lesser test:
 * doc 17 §3 classes tier-1 as "fully functional" offline and doc 01 makes
 * local-first the whole product, so a calendar that stopped taking events
 * because the network went away would be a betrayal of both and nothing else in
 * the suite would catch it.
 *
 * The badge half needed a widget holding cached network data, and `currency` is
 * the one it got.
 *
 * **The last clause nearly became a substitution, and did not have to.** "online
 * → refresh clears badges" has no reachable trigger at a 12 h cadence:
 * `scheduler.execute`'s `finally` recomputes `nextDueAt` from the cadence, and
 * `wake('online')` skips anything not yet due, so neither a reconnect nor a
 * reload revalidates while the cached entry is young — and `swr` hydrating from
 * Dexie sees an age of nearly nothing. The honest trigger is the entry actually
 * ageing past the client TTL, which `page.clock.setFixedTime` arranges without
 * faking a single timer the app depends on. Thirteen hours on, the tile
 * revalidates, meets a refusal, and shows the `stale-error` badge doc 13 §7
 * gives a retry button — which is the reader's own refresh.
 *
 * **One real limit these tests found and work around rather than hide.** A
 * widget's detail is a lazy chunk (doc 06 §1) and doc 17 §2's precache list is
 * the app shell, not every widget chunk — so opening a detail for the *first*
 * time with no connection fails, because the chunk has never been fetched and
 * cache-first has nothing to serve. Every case below therefore visits the
 * surface once while online and then goes offline, which is also what a person
 * does. The gap itself is recorded in doc 17 §2 for the Week 8 PWA pass; it is
 * a precache-list decision, not a bug in any widget.
 */

async function acceptGate(page: Page): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();

	// doc 13 §9's one-time coach sits over the deck and intercepts every click
	// aimed at a tile. Journey #1 asserts it appears; everything else has to get
	// it out of the way first.
	await page.getByTestId('coach-dismiss').click();
	await expect(page.getByTestId('coach')).toBeHidden();
}

/**
 * doc 13 §7: a quiet amber chip in the top bar, `role="status"`.
 *
 * Located by testid rather than by its words, since 2026-08-31. It used to be
 * `getByRole('status').filter({ hasText: 'ngoại tuyến' })`, which was
 * unambiguous only by accident: `widget.weather.offline_short` was the same
 * Vietnamese string, and stayed invisible to this locator purely because the
 * weather badge was a `<span>` with no role. The badge has since moved to the
 * host header (doc 13 §7), where it would have matched — so the chip and the
 * tile badge now say different things (`mất mạng` for a tile's data, this for
 * the app's connection) *and* this is located structurally. Either fix alone
 * would have been one refactor away from breaking six tests at once.
 */
function offlineChip(page: Page) {
	return page.getByTestId('offline-chip');
}

/** The calendar tile is on the seeded deck (doc 13 §9); its header's expand
 *  button is the doc 06 §6 handshake into the detail. */
async function openCalendar(page: Page): Promise<void> {
	const tile = page
		.locator('.grid-stack-item')
		.filter({ has: page.locator('table') })
		.first();
	await tile.getByRole('button', { name: 'mở chi tiết' }).click();
	await expect(page.getByTestId('event-title')).toBeVisible();
}

test('the offline chip appears and clears with the connection', async ({ page, context }) => {
	await acceptGate(page);
	await expect(offlineChip(page)).toBeHidden();

	await context.setOffline(true);
	await expect(offlineChip(page)).toBeVisible();

	await context.setOffline(false);
	await expect(offlineChip(page)).toBeHidden();
});

test('the whole seeded deck keeps rendering offline', async ({ page, context }) => {
	await acceptGate(page);
	const tiles = page.locator('.grid-stack-item');
	// Waited for rather than counted: `count()` on the frame after the gate can
	// catch the grid mid-mount, and the assertion below would then be comparing
	// against a number that was never the answer.
	await expect(tiles).toHaveCount(SEEDED_TILES);

	await context.setOffline(true);
	await expect(offlineChip(page)).toBeVisible();

	// doc 17 §3: tier-1 is "fully functional" offline. Not "degrades politely" —
	// unchanged.
	await expect(tiles).toHaveCount(SEEDED_TILES);
	for (let i = 0; i < SEEDED_TILES; i++) await expect(tiles.nth(i)).toBeVisible();
});

test('the calendar still takes an event with no connection', async ({ page, context }) => {
	await acceptGate(page);
	// Opened first, so the detail chunk is in cache — see the note above.
	await openCalendar(page);

	await context.setOffline(true);
	await expect(offlineChip(page)).toBeVisible();

	const title = page.getByTestId('event-title');
	await expect(title).toBeVisible();
	await title.fill('Họp nhóm ngoại tuyến');
	await page.getByRole('button', { name: 'thêm sự kiện' }).click();

	// Written to IndexedDB, which never needed the network to begin with.
	await expect(page.getByText('Họp nhóm ngoại tuyến')).toBeVisible();
});

test('the event written offline survives a reload once back online', async ({ page, context }) => {
	// The claim doc 01 actually makes: the data is on the device, so a
	// connection coming and going is not an event the data participates in.
	await acceptGate(page);
	await openCalendar(page);
	await context.setOffline(true);

	await page.getByTestId('event-title').fill('Giỗ ông');
	await page.getByRole('button', { name: 'thêm sự kiện' }).click();
	await expect(page.getByText('Giỗ ông')).toBeVisible();

	await context.setOffline(false);
	await page.goto('/');
	await expect(page.getByRole('main')).toBeVisible();

	// Read off the tile rather than by reopening the detail: a day with
	// something on it carries a dot (doc 07 §6), which is the same fact and one
	// fewer moving part.
	await expect(page.locator('.tp-cal__dot').first()).toBeVisible();
});

test('the toolbox still generates offline, which is why it is local', async ({ page, context }) => {
	// doc 07 §7's QR encoder is bundled precisely so this works. A QR generator
	// that needed a server would be the wrong tool for the one moment a person
	// most often wants one.
	await acceptGate(page);

	// The toolbox is not on the seeded deck (doc 13 §9), so add it while the
	// connection is still up — its tile chunk and the QR encoder are both lazy.
	await page.getByTestId('open-drawer').click();
	await page.getByTestId('add-toolbox').click();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('qr-text')).toBeVisible();
	// Encode once online so the encoder chunk is cached, then pull the plug.
	await page.getByTestId('qr-text').fill('warm');
	await expect(page.getByTestId('qr-canvas')).toBeVisible();

	await context.setOffline(true);
	await expect(offlineChip(page)).toBeVisible();

	await page.getByTestId('qr-text').fill('https://tilepier.win');
	await expect(page.getByTestId('qr-canvas')).toBeVisible();
});

test('the quote of the day is there offline, because it was computed', async ({
	page,
	context
}) => {
	// doc 08 §3: a deterministic pick from a bundled dataset. This is the
	// assertion behind moving `quote` out of the cached-data class in doc 06 §3.
	await acceptGate(page);
	await expect(page.getByTestId('quote-text')).toBeVisible();

	// No reload: a cold load with the network down is the service worker's job
	// and `e2e/s5-pwa` already proves it. What this asserts is the different
	// claim doc 08 §3 makes — that the line was *computed*, so losing the
	// network is not an event it participates in.
	await context.setOffline(true);
	await expect(offlineChip(page)).toBeVisible();
	await expect(page.getByTestId('quote-text')).toBeVisible();
	await expect(page.getByTestId('quote-text')).not.toBeEmpty();
});

/* ─────────────────────────────────── the badge half (doc 19 §4 journey #4) */

const FX_DATA = {
	base: 'USD',
	rates: { USD: 1, VND: 26_006.374497, EUR: 0.862295 },
	asOf: 1_788_134_551_000,
	nextUpdateAt: 1_788_221_421_000,
	prevRates: null,
	prevDate: null,
	attribution: 'Rates By Exchange Rate API'
};

const FX_HISTORY_BODY = {
	ok: true,
	data: { base: 'USD', quote: 'VND', points: [], attribution: FX_DATA.attribution },
	meta: { cachedAt: 1_788_134_551, source: 'er-api', stale: false }
};

/** What the tile is set to, so the seed and the assertions cannot drift. */
const FX_TILE = {
	instanceId: 'wgt_fx',
	widgetId: 'currency',
	x: 0,
	y: 0,
	w: 3,
	h: 2,
	settings: { base: 'USD', quote: 'VND', amount: 1 }
};

type FxMode = 'fresh' | 'served-stale' | 'down';

/**
 * Fakes both fx routes from one handler.
 *
 * **Branching on the URL rather than registering two patterns**, because a glob
 * for the rates matches the history route too, and which registration wins is a
 * detail of Playwright's ordering rather than something a test should lean on.
 *
 * The three modes are the three things a reader can be shown: a current table, a
 * table the Worker served past its own KV TTL because upstream was down (doc 11
 * §4, `meta.stale`), and a refusal.
 */
async function routeFx(page: Page, state: { mode: FxMode }): Promise<void> {
	await page.route('**/api/fx**', async (route) => {
		if (state.mode === 'down') {
			await route.fulfill({ status: 503, json: { ok: false, error: { code: 'UPSTREAM_DOWN' } } });
			return;
		}
		if (route.request().url().includes('/history')) {
			await route.fulfill({ json: FX_HISTORY_BODY });
			return;
		}
		await route.fulfill({
			json: {
				ok: true,
				data: FX_DATA,
				meta: {
					cachedAt: 1_788_134_551,
					source: 'er-api',
					stale: state.mode === 'served-stale'
				}
			}
		});
	});
}

/** Seeds a deck of exactly one currency tile and waits for it to have rates. */
async function seedCurrency(page: Page, state: { mode: FxMode }): Promise<void> {
	await routeFx(page, state);
	await acceptGate(page);
	await page.addInitScript(
		([key, value, sentinel]) => {
			if (sessionStorage.getItem(sentinel as string) !== null) return;
			sessionStorage.setItem(sentinel as string, '1');
			localStorage.setItem(key as string, value as string);
		},
		['tp.layout.v1', JSON.stringify({ schemaVersion: 1, grid: [FX_TILE] }), 'tp.e2e.fx'] as const
	);
	await page.reload();
	await expect(page.getByTestId('currency-hero')).toBeVisible();
}

test('a table the Worker served stale reaches the host header as a badge', async ({ page }) => {
	// doc 11 §4's stale-serve, and the reason a networked service's `T` carries
	// the envelope's `meta`: `swr` would call this fresh — it arrived a moment
	// ago — so without `meta.stale` the tile would present a day-old rate as
	// today's, which is the one failure mode this widget has.
	const state: { mode: FxMode } = { mode: 'served-stale' };
	await seedCurrency(page, state);

	await expect(page.getByTestId('tile-badge')).toBeVisible();
	// doc 17 §3's cached-data contract: the number stays, the badge explains it.
	await expect(page.getByTestId('currency-hero')).toBeVisible();
});

test('the tile badge and the top-bar chip are two different things', async ({ page, context }) => {
	// The regression guard for the whole collision analysis. They carried the
	// same Vietnamese string until 2026-08-31 and stayed unambiguous only because
	// the weather badge happened to have no role. One is the app's connection;
	// the other is one tile's data, and a reader has to be able to tell which is
	// which when both are on screen.
	const state: { mode: FxMode } = { mode: 'served-stale' };
	await seedCurrency(page, state);
	await expect(page.getByTestId('tile-badge')).toBeVisible();

	await context.setOffline(true);
	await expect(offlineChip(page)).toBeVisible();

	await expect(offlineChip(page)).toHaveCount(1);
	await expect(page.getByTestId('tile-badge')).toHaveCount(1);
	expect(await offlineChip(page).textContent()).not.toBe(
		await page.getByTestId('tile-badge').textContent()
	);

	await context.setOffline(false);
});

test('rates that go old raise a retry, and pressing it clears the badge', async ({ page }) => {
	/*
	 * journey #4's last clause, and the only way to reach it.
	 *
	 * A 12 h cadence cannot come due inside a test: `scheduler.execute`'s
	 * `finally` recomputes `nextDueAt` from the cadence, and `wake('online')`
	 * skips anything not yet due — so neither a reconnect nor a reload produces a
	 * revalidation while the cached entry is young. What *does* is the entry
	 * genuinely ageing past the client TTL, which `page.clock.setFixedTime` can
	 * arrange without faking any timer the app depends on.
	 *
	 * Thirteen hours on, `swr` hydrates from Dexie, sees it stale, revalidates,
	 * and gets a refusal — which is `stale-error` with a payload in hand, the one
	 * state doc 13 §7 gives a retry button.
	 */
	const state: { mode: FxMode } = { mode: 'fresh' };
	await page.clock.setFixedTime(new Date('2026-08-31T10:00:00Z'));
	await seedCurrency(page, state);
	await expect(page.getByTestId('tile-badge')).toBeHidden();

	state.mode = 'down';
	await page.clock.setFixedTime(new Date('2026-08-31T23:00:00Z'));
	await page.reload();

	await expect(page.getByTestId('currency-hero')).toBeVisible();
	const retry = page.getByTestId('tile-retry');
	await expect(retry).toBeVisible();

	state.mode = 'fresh';
	await retry.click();

	await expect(page.getByTestId('tile-badge')).toBeHidden();
	await expect(page.getByTestId('currency-hero')).toBeVisible();
});
