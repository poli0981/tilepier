import { expect, test, type Page } from '@playwright/test';
import { WEATHER_OK } from '../src/lib/core/__fixtures__/weather';
import { axeViolations } from './_lib/axe';

/**
 * The accessibility sweep (doc 13 §8, doc 19 §4): axe-core over every surface
 * a reader meets, WCAG 2.2 A and AA.
 *
 * Every PR scans each kind of surface once — the light theme throughout, since
 * it is the one that had never been measured, plus the dark theme's gate, deck
 * and settings and the 375 px layouts. The schedule adds every widget's detail
 * in both themes (`@nightly`), which is too long for a per-PR gate.
 *
 * `/api/*` answers 503 here: a scan must not depend on an upstream, and a
 * widget's error state is a surface like any other. The one exception is a
 * second weather tile, given a place and the recorded forecast, because a tile
 * with data carries the deck's one credit link (doc 10 §8) and an error card
 * carries none; the first weather tile keeps no place, so the place search is
 * scanned as well. Motion is reduced so that
 * no transition is caught half-way when colours are measured. The deck holds
 * all fifteen widgets: `/w/<id>` for a widget that is not on it shows an offer
 * to pin it rather than the detail, which is how the first draft of this file
 * scanned ten "details" that were not there.
 *
 * Beside axe, every surface outside a tile is held to doc 13 §8's 40 px
 * target (`expectTargets`); inside a tile axe's own target-size rule holds it
 * to WCAG 2.2's 24 px, the owner's Week 8 call.
 */

type Theme = 'dark' | 'light';

const WIDGETS = [
	'clock',
	'timer',
	'calc',
	'notes',
	'todo',
	'calendar',
	'toolbox',
	'quote',
	'weather',
	'currency',
	'markets',
	'rss',
	'map',
	'music',
	'media'
] as const;

/** Every widget once, stacked; the grid clamps each to its manifest's size. */
const FULL_DECK = [
	...WIDGETS.map((widgetId, index) => ({
		instanceId: `wgt_a11y_${widgetId}`,
		widgetId,
		x: 0,
		y: index * 4,
		w: 4,
		// Four rows, so the calculator shows its keypad (doc 07 §3) and is scanned
		// with it; its compact form has a component test of its own.
		h: 4,
		settings: {}
	})),
	// Last, so `/w/weather` still opens the first weather tile, which has no
	// place. At its smallest size, where the credit is closest to the rest.
	{
		instanceId: 'wgt_a11y_weather_placed',
		widgetId: 'weather',
		x: 0,
		y: WIDGETS.length * 4,
		w: 2,
		h: 2,
		settings: { place: { name: 'Hà Nội', lat: 21.02, lon: 105.85 } }
	}
];

/** Settings, the deck and the gate's acceptance, written before any page script runs. */
async function seed(
	page: Page,
	options: { theme: Theme; accepted?: boolean; coach?: boolean }
): Promise<void> {
	await page.route('**/api/**', (route) =>
		route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({ error: { code: 'UPSTREAM_DOWN' } })
		})
	);
	// Registered later, so it answers first (Playwright runs routes newest first).
	await page.route('**/api/weather*', (route) => route.fulfill({ json: WEATHER_OK }));
	await page.addInitScript(
		([theme, accepted, coach, grid]) => {
			if (sessionStorage.getItem('tp.e2e.a11y') !== null) return;
			sessionStorage.setItem('tp.e2e.a11y', '1');
			localStorage.setItem('tp.layout.v1', JSON.stringify({ schemaVersion: 1, grid }));
			localStorage.setItem(
				'tp.settings.v1',
				JSON.stringify({
					schemaVersion: 1,
					locale: 'vi',
					theme,
					accent: '#46d5c8',
					clock24h: true,
					weekStartsOn: 1,
					reducedMotion: 'on',
					coachDismissed: !coach,
					debug: false
				})
			);
			// LEGAL_VERSION 3 (doc 16 §2), as e2e/legal-gate asserts it.
			if (accepted)
				localStorage.setItem(
					'tp.legal.v1',
					JSON.stringify({ acceptedVersion: 3, acceptedAt: new Date(0).toISOString() })
				);
		},
		[options.theme, options.accepted ?? true, options.coach ?? false, FULL_DECK] as const
	);
}

async function deck(page: Page): Promise<void> {
	await page.goto('/');
	await expect(page.locator('.grid-stack-item').first()).toBeVisible();
	// The placed weather tile has its data, so the scan meets its credit.
	await expect(page.getByRole('link', { name: 'Open-Meteo.com' })).toBeVisible();
}

/**
 * Controls outside a tile smaller than 40 × 40 (doc 13 §8). A label that
 * activates its control is part of the target, so a checkbox counts by the
 * larger of the two, and a visually hidden file input by its label; a link
 * inside running text is exempt, as WCAG 2.5.8 exempts it.
 */
async function smallTargets(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const found: string[] = [];
		const selector =
			'button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary';
		for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
			if (element.closest('.grid-stack-item') !== null) continue;
			const style = getComputedStyle(element);
			if (style.display === 'none' || style.visibility === 'hidden') continue;
			if (element.tagName === 'A' && style.display === 'inline' && element.closest('p, li, dd, td'))
				continue;
			const boxes = [element.getBoundingClientRect()];
			if (element instanceof HTMLInputElement && element.labels !== null)
				for (const label of Array.from(element.labels)) boxes.push(label.getBoundingClientRect());
			const shown = boxes.filter((box) => box.width > 1 && box.height > 1);
			if (shown.length === 0) continue;
			if (shown.some((box) => box.width >= 39.5 && box.height >= 39.5)) continue;
			const [box] = shown;
			const name = (element.getAttribute('aria-label') ?? element.textContent ?? '').trim();
			found.push(
				`${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)} ${element.tagName.toLowerCase()} "${name.slice(0, 32)}"`
			);
		}
		return found;
	});
}

async function expectTargets(page: Page): Promise<void> {
	expect(await smallTargets(page)).toEqual([]);
}

async function expectClean(page: Page, include?: string): Promise<void> {
	// Settled pixels only: a panel caught mid-fade blends with the page behind
	// and reads as a contrast failure no reader ever sees. Looping animations
	// (a loading gauge) never finish, so only finite ones are waited for.
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter(
					(animation) =>
						animation.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY
				)
				.map((animation) => animation.finished.catch(() => undefined))
		)
	);
	expect(await axeViolations(page, include)).toEqual([]);
}

test.describe('the light theme', () => {
	test('the gate', async ({ page }) => {
		await seed(page, { theme: 'light', accepted: false });
		await page.goto('/');
		await expect(page.getByRole('button', { name: 'Tôi đồng ý' })).toBeEnabled();
		await expectClean(page);
		await expectTargets(page);
	});

	test('the deck', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await deck(page);
		await expectClean(page);
		await expectTargets(page);
	});

	test('the deck in edit mode', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await deck(page);
		await page.keyboard.press('e');
		await expect(page.getByTestId('edit-strip')).toBeVisible();
		await expectClean(page);
		await expectTargets(page);
	});

	test('the add drawer', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await deck(page);
		await page.getByTestId('open-drawer').click();
		await expect(page.getByTestId('add-drawer')).toBeVisible();
		await expectClean(page);
		await expectTargets(page);
	});

	test('the shortcuts sheet', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await deck(page);
		await page.keyboard.press('?');
		await expect(page.getByTestId('shortcuts')).toBeVisible();
		await expectClean(page);
		await expectTargets(page);
	});

	test('the first-run coach', async ({ page }) => {
		await seed(page, { theme: 'light', coach: true });
		await deck(page);
		await expect(page.getByTestId('coach')).toBeVisible();
		await expectClean(page);
		await expectTargets(page);
	});

	test('settings, with diagnostics open', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await page.goto('/settings?debug=1');
		await expect(page.locator('[data-ready="true"]')).toBeAttached();
		await expectClean(page);
		await expectTargets(page);
	});

	test('the bug dialog', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await page.goto('/settings');
		await expect(page.locator('[data-ready="true"]')).toBeAttached();
		await page.getByTestId('open-bug').click();
		await expect(page.getByTestId('bug-dialog')).toBeVisible();
		await expectClean(page);
		await expectTargets(page);
	});

	test('a detail opened over the deck', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await deck(page);
		await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
		await expect(page.getByTestId('detail-panel')).toBeVisible();
		await expectClean(page);
		await expectTargets(page);
	});

	for (const widget of ['notes', 'calendar', 'weather', 'music'] as const) {
		test(`the ${widget} detail`, async ({ page }) => {
			await seed(page, { theme: 'light' });
			await page.goto(`/w/${widget}`);
			await expect(page.getByTestId('detail-standalone')).toBeVisible();
			await expectClean(page);
			await expectTargets(page);
		});
	}

	test('the licences page', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await page.goto('/legal/licenses');
		await expectClean(page);
	});

	test('a page that does not exist', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await page.goto('/no-such-page');
		await expectClean(page);
	});
});

test.describe('the dark theme', () => {
	test('the gate', async ({ page }) => {
		await seed(page, { theme: 'dark', accepted: false });
		await page.goto('/');
		await expect(page.getByRole('button', { name: 'Tôi đồng ý' })).toBeEnabled();
		await expectClean(page);
	});

	test('the deck', async ({ page }) => {
		await seed(page, { theme: 'dark' });
		await deck(page);
		await expectClean(page);
	});

	test('settings', async ({ page }) => {
		await seed(page, { theme: 'dark' });
		await page.goto('/settings');
		await expect(page.locator('[data-ready="true"]')).toBeAttached();
		await expectClean(page);
	});
});

test.describe('a phone, 375 px wide', () => {
	test.use({ viewport: { width: 375, height: 740 } });

	test('the deck', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await deck(page);
		await expectClean(page);
	});

	test('a detail as a full-screen sheet', async ({ page }) => {
		await seed(page, { theme: 'light' });
		await deck(page);
		await page.getByRole('button', { name: 'mở chi tiết' }).first().click();
		await expect(page.getByTestId('detail-panel')).toBeVisible();
		await expectClean(page);
	});
});

test.describe('every detail and page, both themes @nightly', () => {
	for (const theme of ['light', 'dark'] as const) {
		for (const widget of WIDGETS) {
			test(`${theme}: the ${widget} detail @nightly`, async ({ page }) => {
				await seed(page, { theme });
				await page.goto(`/w/${widget}`);
				await expect(page.getByTestId('detail-standalone')).toBeVisible();
				await expectClean(page);
				await expectTargets(page);
			});
		}

		for (const path of ['/about', '/offline', '/legal/terms', '/legal/privacy']) {
			test(`${theme}: ${path} @nightly`, async ({ page }) => {
				await seed(page, { theme });
				await page.goto(path);
				await expectClean(page);
			});
		}
	}
});
