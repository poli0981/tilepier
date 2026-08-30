import { expect, test, type Page } from '@playwright/test';
import { seedLayout } from './_lib/seed';
import { WEATHER_OK } from '../src/lib/core/__fixtures__/weather';

/**
 * doc 19 §4 journey #3 — "open weather detail (fixture data) → chart canvas
 * present → Esc closes → Back/forward behave."
 *
 * Deferred from Week 3 with the weather detail, as doc 23 said it would be.
 *
 * **This is the first spec in the suite that fakes a response.** Everything
 * before it either needed no network or drove `context.setOffline`. MSW is
 * wired for the node project only — there is no `mockServiceWorker.js` in
 * `static/`, and doc 15 §6 keeps msw's postinstall denied — so the mechanism
 * here is Playwright's own `page.route`, which the service worker leaves alone
 * because it passes `/api/*` straight through (`src/service-worker.ts`).
 */

const HANOI = { name: 'Hà Nội', lat: 21.02, lon: 105.85 };

async function acceptGate(page: Page): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
}

/** One weather tile, pinned to a place, with the recorded envelope behind it. */
async function seedPlacedWeather(page: Page): Promise<void> {
	await page.route('**/api/weather*', async (route) => {
		await route.fulfill({ json: WEATHER_OK });
	});

	await acceptGate(page);
	await seedLayout(page, [
		{
			instanceId: 'wgt_wx',
			widgetId: 'weather',
			x: 0,
			y: 0,
			w: 4,
			h: 3,
			settings: { place: HANOI }
		}
	]);
	await page.reload();
	await expect(page.getByTestId('weather-readout')).toBeVisible();
}

test('the weather detail opens onto a real chart, and Escape closes it', async ({ page }) => {
	await seedPlacedWeather(page);

	await page.getByRole('button', { name: 'mở chi tiết' }).click();

	await expect(page).toHaveURL(/\/w\/weather\?i=wgt_wx/);
	await expect(page.getByTestId('weather-detail')).toBeVisible();

	// The canvas, not a placeholder: the chart chunk is a separate lazy request,
	// and "the panel opened" would pass with the module still in flight.
	await expect(page.locator('[data-testid="chart-canvas"] canvas')).toBeVisible();
	// doc 13 §8 pairs every chart with a line somebody can read.
	await expect(page.getByTestId('chart-summary')).not.toBeEmpty();

	await page.keyboard.press('Escape');
	await expect(page.getByTestId('weather-detail')).toBeHidden();
	await expect(page).toHaveURL(/\/$/);
});

test('Back closes the detail, and Forward opens it again', async ({ page }) => {
	// doc 13 §5: the panel is `pushState`, so the browser's own buttons are part
	// of its contract rather than an accident of it.
	await seedPlacedWeather(page);

	await page.getByRole('button', { name: 'mở chi tiết' }).click();
	await expect(page.getByTestId('weather-detail')).toBeVisible();

	await page.goBack();
	await expect(page.getByTestId('weather-detail')).toBeHidden();
	await expect(page.getByTestId('weather-readout')).toBeVisible();

	await page.goForward();
	await expect(page.getByTestId('weather-detail')).toBeVisible();
	await expect(page.locator('[data-testid="chart-canvas"] canvas')).toBeVisible();
});

test('a direct load of the detail URL renders it full screen', async ({ page }) => {
	// doc 13 §5.4: no animation, and "◂ về bàn" rather than a panel over a deck
	// that was never there.
	await seedPlacedWeather(page);

	await page.goto('/w/weather?i=wgt_wx');

	await expect(page.getByTestId('weather-detail')).toBeVisible();
	await expect(page.locator('[data-testid="chart-canvas"] canvas')).toBeVisible();
});
