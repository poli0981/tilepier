import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TpTileSize } from '$lib/core/types';
import { settings } from '$lib/stores/settings.svelte';
import TpClockWidget from './TpClockWidget.svelte';

/**
 * doc 07 §1's tile. The zone maths is proved in `service.test.ts` and the lunar
 * maths in `lib/lunar`; what is checked here is the line those two meet on —
 * the date line, and that it carries the lunar date in Vietnamese and does not
 * in English.
 *
 * The clock had no component test before this: it shipped in Week 1 covered by
 * `e2e/journey-2-layout`, which asserts a tile renders rather than what it
 * says. The lunar line is the first thing on it worth asserting in isolation.
 */

const SIZE: TpTileSize = { w: 3, h: 2, pxW: 300, pxH: 200, tier: 'M' };
const SMALL: TpTileSize = { w: 2, h: 1, pxW: 180, pxH: 72, tier: 'S' };

/** 09:00 on 2026-08-28 in Hanoi — a Friday, lunar 16/07 of Bính Ngọ. */
const AT = Date.UTC(2026, 7, 28, 2, 0);

function props(size: TpTileSize = SIZE) {
	return { instanceId: 'wgt_clock', settings: {}, size };
}

beforeEach(() => {
	// Frozen, because the assertion below is about a specific lunar date and
	// `Date.now()` would make it a test that stops passing on a given evening.
	vi.useFakeTimers();
	vi.setSystemTime(AT);
	settings.dispose();
	settings.hydrate();
});

afterEach(() => {
	settings.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('the date line (doc 07 §1)', () => {
	it('carries the lunar date in Vietnamese', async () => {
		settings.patch({ locale: 'vi' });
		const screen = render(TpClockWidget, props());
		// 2026-08-28 is lunar 16/07 in the year Bính Ngọ.
		await expect.element(screen.getByText('16/07 Bính Ngọ')).toBeInTheDocument();
	});

	it('leaves it off in English rather than transliterating the can-chi', async () => {
		settings.patch({ locale: 'en' });
		const screen = render(TpClockWidget, props());
		await expect.element(screen.getByText(/Bính/)).not.toBeInTheDocument();
		await expect.element(screen.getByText(/lunar month/)).not.toBeInTheDocument();
	});

	it('computes from the Vietnamese day, not the runner’s', async () => {
		// 23:00 UTC on the 27th is already the 28th in Hanoi. A tile that read
		// the browser's own date would show the previous lunar day for every
		// viewer west of Vietnam for part of each day.
		vi.setSystemTime(Date.UTC(2026, 7, 27, 23, 0));
		settings.patch({ locale: 'vi' });
		const screen = render(TpClockWidget, props());
		await expect.element(screen.getByText('16/07 Bính Ngọ')).toBeInTheDocument();
	});

	it('disappears with the whole date line at the smallest tier', async () => {
		// doc 13 §3: at h = 1 the tile is a single hero value and nothing else.
		settings.patch({ locale: 'vi' });
		const screen = render(TpClockWidget, props(SMALL));
		await expect.element(screen.getByText(/Bính Ngọ/)).not.toBeInTheDocument();
	});
});
