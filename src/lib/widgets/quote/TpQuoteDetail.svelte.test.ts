import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpQuoteDetail from './TpQuoteDetail.svelte';
import { loadCatalogue } from './service';

/** doc 08 §3's detail — browse, search, and the favourites the tile writes. */

const AT = new Date(2026, 7, 28, 10, 0);
const catalogue = await loadCatalogue();

function props(bag: Record<string, unknown> = {}, onUpdateSettings = vi.fn()) {
	return { instanceId: 'wgt_q', settings: bag, onUpdateSettings, close: vi.fn() };
}

/** The catalogue is a dynamic import, so nothing below it exists on the first
 *  frame. `expect.element` retries; `.element()` and `querySelectorAll` do not,
 *  so anything reaching for a raw node has to wait here first. */
const ALL = m['widget.quote.results']({
	count: catalogue.quotes.length,
	total: catalogue.quotes.length
});

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(AT);
	settings.dispose();
	settings.hydrate();
	settings.patch({ locale: 'vi' });
});

afterEach(() => {
	cleanup();
	settings.dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('browsing', () => {
	it('opens showing the whole collection', async () => {
		const screen = render(TpQuoteDetail, props());
		await expect.element(screen.getByTestId('quote-count')).toHaveTextContent(
			m['widget.quote.results']({
				count: catalogue.quotes.length,
				total: catalogue.quotes.length
			})
		);
	});

	it("shows today's quote above the browse", async () => {
		const screen = render(TpQuoteDetail, props());
		await expect.element(screen.getByTestId('today-text')).toBeInTheDocument();
	});

	it('narrows on a search, and the count follows', async () => {
		const screen = render(TpQuoteDetail, props());
		await expect.element(screen.getByTestId('quote-count')).toHaveTextContent(ALL);

		await screen.getByTestId('quote-search').fill('perseverance');
		await expect.element(screen.getByTestId('quote-count')).not.toHaveTextContent(ALL);
	});

	it('folds diacritics, so a search without marks still finds Vietnamese', async () => {
		const screen = render(TpQuoteDetail, props());
		await screen.getByTestId('quote-search').fill('kien tri');
		await expect.element(screen.getByTestId('quote-empty')).not.toBeInTheDocument();
	});

	it('says nothing matches rather than showing an empty list', async () => {
		// doc 06 §3's `empty`. The two shapes it has here are different
		// sentences, because they lead to different actions.
		const screen = render(TpQuoteDetail, props());
		await screen.getByTestId('quote-search').fill('zzzzqqqq');
		await expect.element(screen.getByText(m['widget.quote.no_matches']())).toBeInTheDocument();
	});

	it('offers every theme the dataset carries', async () => {
		const screen = render(TpQuoteDetail, props());
		await expect.element(screen.getByTestId('quote-count')).toHaveTextContent(ALL);

		const select = (await screen
			.getByTestId('quote-tag')
			.element()) as unknown as HTMLSelectElement;
		// The "any theme" option plus the real ones.
		expect(select.options.length).toBeGreaterThan(5);
		expect([...select.options].map((option) => option.value)).toContain('perseverance');
	});

	it('filters by theme', async () => {
		const screen = render(TpQuoteDetail, props());
		await expect.element(screen.getByTestId('quote-count')).toHaveTextContent(ALL);

		await screen.getByTestId('quote-tag').selectOptions('perseverance');
		await expect.element(screen.getByTestId('quote-count')).not.toHaveTextContent(ALL);
	});
});

describe('favourites', () => {
	it('says the list is empty in its own words, not the no-matches ones', async () => {
		// "nothing kept yet" leads to a different action than "nothing matches",
		// so doc 12 §8's one-action rule needs two sentences here.
		const screen = render(TpQuoteDetail, props());
		await expect.element(screen.getByTestId('quote-count')).toHaveTextContent(ALL);
		await screen.getByTestId('quote-kept-only').click();
		await expect.element(screen.getByText(m['widget.quote.no_favourites']())).toBeInTheDocument();
	});

	it('narrows to the kept ones when there are some', async () => {
		const first = catalogue.quotes[0];
		const screen = render(TpQuoteDetail, props({ favourites: [first?.id] }));
		await expect.element(screen.getByTestId('quote-count')).toHaveTextContent(ALL);
		await screen.getByTestId('quote-kept-only').click();

		await expect
			.element(screen.getByTestId('quote-count'))
			.toHaveTextContent(m['widget.quote.results']({ count: 1, total: catalogue.quotes.length }));
	});

	it('writes a keep back through onUpdateSettings', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(TpQuoteDetail, props({}, onUpdateSettings));
		await expect.element(screen.getByTestId('quote-count')).toHaveTextContent(ALL);

		// The unfiltered list, deliberately. Searching for a theme name would
		// find nothing: `filterQuotes` matches the text and the attribution, and
		// the themes have their own control beside the box.
		const buttons = screen.container.querySelectorAll('.tp-quoted__list button');
		expect(buttons.length).toBeGreaterThan(0);
		(buttons[0] as HTMLButtonElement).click();

		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalled();
		});
		const patch = onUpdateSettings.mock.calls[0]?.[0] as { favourites: string[] };
		expect(patch.favourites).toHaveLength(1);
	});
});

describe('provenance', () => {
	it('says on the panel where the collection comes from', async () => {
		// doc 16 §1's obligation, said where a reader of the quotes is rather
		// than only on the licences page.
		const screen = render(TpQuoteDetail, props());
		await expect.element(screen.getByText(m['widget.quote.source_note']())).toBeInTheDocument();
	});
});
