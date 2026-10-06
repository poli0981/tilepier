import '../../../app.css';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { scheduler } from '$lib/core/scheduler';
import { swrCache } from '$lib/core/swr.svelte';
import { tileStatusChannel } from '$lib/core/tile-status';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { WEATHER_OK } from '$lib/core/__fixtures__/weather';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpWeatherReadout from './TpWeatherReadout.svelte';

/**
 * The readout in a tile's frame, with the real stylesheet. That is why this is
 * not in `TpWeatherWidget.svelte.test.ts`: component tests run without app.css,
 * and what this measures is line heights and a font.
 *
 * The frame is the body of a 2 × 2 tile at its narrowest, 163 × 82 px: two of
 * the twelve columns of a 1280 px grid, less gridstack's inset, the border and
 * the body's padding. The 82 was read off production on 2026-10-07. Open-Meteo's
 * credit has to fit it whole (doc 10 §8), and the payload's sentence, at 206 px
 * in Be Vietnam Pro, does not — which is why the tile's link is the domain.
 */

/** 2026-08-28T09:30 at the place, the fixture's first hour. */
const NOW = new Date(Date.UTC(2026, 7, 28, 2, 30));

const HANOI = { name: 'Hà Nội', lat: 21.02, lon: 105.85 };

let db: TpDb;
let frame: HTMLDivElement;

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settings.dispose();
	settings.hydrate();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	tileStatusChannel.clear();
	db = createDb(`tilepier-wxr-${crypto.randomUUID()}`);
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify(WEATHER_OK), {
					headers: { 'content-type': 'application/json' }
				})
		)
	);
	frame = document.createElement('div');
	// What `.tp-host__body` gives the widget: its box, and the clip at its edge.
	frame.style.cssText = 'width: 163px; height: 82px; overflow: hidden;';
	document.body.appendChild(frame);
});

afterEach(async () => {
	cleanup();
	frame.remove();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	tileStatusChannel.clear();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	db.close();
	await db.delete();
});

describe('the readout in the smallest tile', () => {
	it('keeps the credit whole: inside the frame, and not cut short', async () => {
		const screen = render(TpWeatherReadout, {
			target: frame,
			props: {
				instanceId: 'wgt_wx',
				place: HANOI,
				size: { w: 2, h: 2, pxW: 189, pxH: 120, tier: 'M' as const },
				db
			}
		});

		const credit = screen.getByRole('link', { name: m['widget.weather.credit']() });
		await expect.element(credit).toBeInTheDocument();
		await expect.element(screen.getByTestId('weather-temp')).toHaveTextContent('31°');

		// Measured in the font the reader gets, or not at all.
		await document.fonts.load('12px "Be Vietnam Pro"');
		const faces = [...document.fonts].filter((face) => face.family.includes('Be Vietnam Pro'));
		expect(faces.some((face) => face.status === 'loaded')).toBe(true);

		const link = credit.element() as HTMLAnchorElement;
		const edge = frame.getBoundingClientRect();
		expect(link.getBoundingClientRect().right, 'past the side').toBeLessThanOrEqual(edge.right);
		expect(link.scrollWidth, 'wider than the tile').toBeLessThanOrEqual(link.clientWidth);

		// The credit always reaches the foot (`margin-top: auto`), so a tile too
		// short for it does not clip it: the reading's row gives way instead, and
		// spills over the gap. So the readout is measured at the height it asks
		// for, which has to fit. At an 18 px credit line it asked for 83.6.
		const readout = frame.querySelector<HTMLElement>('.tp-wx');
		if (readout === null) throw new Error('no readout');
		readout.style.height = 'auto';
		expect(readout.getBoundingClientRect().height, 'taller than the tile').toBeLessThanOrEqual(
			edge.height
		);
	});
});
