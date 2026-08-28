import { expect, test, type Page } from '@playwright/test';
import { SEEDED_TILES } from './_lib/seed';

/**
 * doc 19 §4 journey #4: "Offline emulation: toggle offline → stale badges
 * appear → tier-1 widgets still work → online → refresh clears badges."
 *
 * **Half of it, deliberately, and the half that exists.** Stale badges need a
 * widget with cached network data, and the first of those is weather in Week 4
 * — doc 23 says as much. What is testable now is the other three quarters of
 * that sentence, and it is the part that would be least obvious if it broke:
 * that going offline does not degrade a deck made entirely of local widgets.
 *
 * That is not a lesser test. doc 17 §3 classes tier-1 as "fully functional"
 * offline and doc 01 makes local-first the whole product; a calendar that
 * stopped taking events because the network went away would be a betrayal of
 * both, and nothing else in the suite would catch it.
 *
 * The stale-badge assertions land here in Week 4, against the weather tile.
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

/** doc 13 §7: a quiet amber chip in the top bar, `role="status"`. */
function offlineChip(page: Page) {
	return page.getByRole('status').filter({ hasText: 'ngoại tuyến' });
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
