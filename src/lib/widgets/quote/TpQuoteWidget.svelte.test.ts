import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { scheduler } from '$lib/core/scheduler';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpQuoteWidget from './TpQuoteWidget.svelte';
import { bilingualPool, loadCatalogue, pickOfDay, quoteText } from './service';

/**
 * The load is wrapped rather than replaced, so the happy path still reads the
 * real catalogue and only the one case that wants a failure gets one. Without
 * this there is no seam at all: `loadCatalogue` memoises a dynamic import, and
 * the error branch would be the only state doc 19 §6 requires that nothing
 * exercises.
 */
const control = vi.hoisted(() => ({ fail: false }));

vi.mock('./service', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./service')>();
	return {
		...actual,
		loadCatalogue: async () => {
			if (control.fail) throw new Error('catalogue unavailable');
			return actual.loadCatalogue();
		}
	};
});

/**
 * doc 08 §3's tile, and doc 06 §3's states for it.
 *
 * The expected quote is read from the catalogue through the same `pickOfDay`
 * the widget uses, which sounds circular and is not: `service.test.ts` proves
 * the pick is a stable, well-spread function of the date, and what is being
 * checked here is that the tile renders *that* entry in *that* language. A
 * hardcoded string would break on the next re-import for no useful reason.
 */

const SIZE: TpTileSize = { w: 4, h: 2, pxW: 400, pxH: 160, tier: 'M' };
const AT = new Date(2026, 7, 28, 10, 0);

const catalogue = await loadCatalogue();
const pool = bilingualPool(catalogue);
const expected = pickOfDay(pool, '2026-08-28');

function props(bag: Record<string, unknown> = {}, onUpdateSettings = vi.fn()) {
	return { instanceId: 'wgt_q', settings: bag, size: SIZE, onUpdateSettings };
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(AT);
	settings.dispose();
	settings.hydrate();
	settings.patch({ locale: 'vi' });
	scheduler.reset();
});

afterEach(() => {
	cleanup();
	scheduler.reset();
	settings.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('the quote of the day', () => {
	it('shows the entry the date picks, in Vietnamese', async () => {
		const screen = render(TpQuoteWidget, props());
		await expect
			.element(screen.getByTestId('quote-text'))
			.toHaveTextContent(quoteText(expected!, 'vi'));
	});

	it('shows the same entry in English, which is doc 08 §3 edge case', async () => {
		// The locale switches the translation, not the quote — which is the
		// whole reason the pick runs over the bilingual pool.
		settings.patch({ locale: 'en' });
		const screen = render(TpQuoteWidget, props());
		await expect
			.element(screen.getByTestId('quote-text'))
			.toHaveTextContent(quoteText(expected!, 'en'));
	});

	it('credits whoever said it', async () => {
		const screen = render(TpQuoteWidget, props());
		await expect.element(screen.getByTestId('quote-cite')).toBeInTheDocument();
	});

	it('carries the lunar footer in Vietnamese and not in English', async () => {
		// doc 08 §3's QuoteAtlas tie-in. 28 August 2026 is lunar 16/07.
		const screen = render(TpQuoteWidget, props());
		await expect.element(screen.getByTestId('quote-lunar')).toHaveTextContent('16/07 Bính Ngọ');

		cleanup();
		settings.patch({ locale: 'en' });
		const english = render(TpQuoteWidget, props());
		await expect.element(english.getByTestId('quote-text')).toBeInTheDocument();
		await expect.element(english.getByTestId('quote-lunar')).not.toBeInTheDocument();
	});
});

describe('states (doc 06 §3)', () => {
	it('shows a skeleton rather than a blank while the catalogue loads', async () => {
		// A real frame, not a theoretical one: 23 KB gz behind a dynamic import.
		const screen = render(TpQuoteWidget, props());
		await expect.element(screen.getByTestId('quote-text')).toBeInTheDocument();
		// The label is what an assistive technology hears during that frame.
		expect(m['widget.quote.loading']()).not.toBe('');
	});

	it('says so inline if the catalogue cannot be read, and does not blank', async () => {
		control.fail = true;
		try {
			const screen = render(TpQuoteWidget, props());
			await expect.element(screen.getByText(m['widget.quote.failed']())).toBeInTheDocument();
			// doc 13 §7: an error is a sentence, not an empty tile.
			await expect.element(screen.getByTestId('quote-text')).not.toBeInTheDocument();
		} finally {
			control.fail = false;
		}
	});
});

describe('favourites', () => {
	it('marks the kept state from settings', async () => {
		const screen = render(TpQuoteWidget, props({ favourites: [expected?.id] }));
		await expect.element(screen.getByTestId('quote-keep')).toHaveAttribute('aria-pressed', 'true');
	});

	it('writes the id back on a press, newest first', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(TpQuoteWidget, props({ favourites: ['other'] }, onUpdateSettings));

		await screen.getByTestId('quote-keep').click();
		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({
				favourites: [expected?.id, 'other']
			});
		});
	});

	it('removes it on a second press', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(
			TpQuoteWidget,
			props({ favourites: [expected?.id, 'other'] }, onUpdateSettings)
		);

		await screen.getByTestId('quote-keep').click();
		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({ favourites: ['other'] });
		});
	});
});

describe('the scheduler wiring (doc 04 §3)', () => {
	it('registers one midnight task and lets it go on unmount', async () => {
		render(TpQuoteWidget, props());
		expect(scheduler.inspect()).toHaveLength(1);
		expect(scheduler.inspect()[0]?.cadence).toEqual({ kind: 'midnight' });

		cleanup();
		expect(scheduler.size).toBe(0);
	});
});
