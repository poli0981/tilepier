import { foldForSearch } from '$lib/i18n/fold';

/**
 * doc 08 §3's data layer.
 *
 * The dataset is bundled, so there is no network here at all — that section
 * says as much, and calls the widget "effectively Tier 1" despite living in the
 * tier-2 document for historical ordering. doc 06 §3 and doc 17 §3 were
 * corrected to match on 2026-08-28.
 *
 * `data/quotes.json` is built by `scripts/quotes-import.mjs`, which is doc 16
 * §1's per-entry licence audit made mechanical. Do not hand-edit it.
 */

export interface TpQuote {
	id: string;
	vi?: string;
	en?: string;
	author?: string;
	work?: string;
	source?: string;
	year?: number;
	rights: string;
	tags?: string[];
}

export interface TpQuoteCatalogue {
	version: number;
	source: string;
	counts: { total: number; bilingual: number; viOnly: number; enOnly: number };
	quotes: TpQuote[];
}

export type TpQuoteLocale = 'vi' | 'en';

/** doc 08 §3: favourites are an id list in the tile's settings, capped. */
export const FAVOURITES_MAX = 200;

export interface TpQuoteSettings {
	favourites: readonly string[];
}

let cached: TpQuoteCatalogue | null = null;

/**
 * Loaded through `await import()`, which is not optional: the catalogue is
 * 89 KB raw and 23 KB gzipped, against a 40 KB per-tile budget (doc 20 §6). A
 * static import would put all of it in the tile chunk.
 */
export async function loadCatalogue(): Promise<TpQuoteCatalogue> {
	cached ??= ((await import('./data/quotes.json')) as { default: TpQuoteCatalogue }).default;
	return cached;
}

/**
 * The entries that exist in both languages — the only honest pool for a daily
 * pick, because doc 08 §3 requires a locale switch mid-day to keep the same
 * quote and swap the translation. 284 of the 386 entries qualify; the rest are
 * still browsable, they just cannot be today's.
 */
export function bilingualPool(catalogue: TpQuoteCatalogue): TpQuote[] {
	return catalogue.quotes.filter((quote) => quote.vi !== undefined && quote.en !== undefined);
}

/**
 * FNV-1a, 32-bit. Any stable hash would do; what matters is that it is
 * arithmetic rather than a random seed, so every device on a given date lands
 * on the same entry with nothing shared between them and nothing fetched.
 */
function hash(value: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		// The FNV prime, by shifts because `h * 16777619` overflows a double's
		// exact-integer range and quietly stops being the same function.
		h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
	}
	return h >>> 0;
}

/**
 * doc 08 §3's quote of the day: the same for every reader on a given date,
 * computed rather than fetched, and therefore correct offline.
 *
 * Keyed on the viewer's own calendar date, which is what makes "today" mean
 * what a reader means by it. Two readers in different zones are on different
 * dates for part of the day and see different quotes then, which is the same
 * answer the clock tile's lunar line gives for the same reason.
 *
 * The pick does move if the dataset grows — a date maps to an index, not to an
 * id. That is a release-to-release change, not a day-to-day one, and pinning it
 * would mean freezing the pool forever.
 */
export function pickOfDay(pool: readonly TpQuote[], dateKey: string): TpQuote | null {
	if (pool.length === 0) return null;
	return pool[hash(dateKey) % pool.length] ?? null;
}

/** `''` when the entry has nothing in this language — a caller showing the
 *  daily quote never sees that, since the pool is bilingual by construction. */
export function quoteText(quote: TpQuote, locale: TpQuoteLocale): string {
	return (locale === 'vi' ? quote.vi : quote.en) ?? quote.vi ?? quote.en ?? '';
}

/**
 * The line under the quote: whoever said it, or where it came from when nobody
 * did. Proverbs have a `source` and no author, which is not a missing field.
 */
export function attributionOf(quote: TpQuote): string {
	return quote.author ?? quote.source ?? quote.work ?? '';
}

export function tagsOf(catalogue: TpQuoteCatalogue): string[] {
	const tags = new Set<string>();
	for (const quote of catalogue.quotes) for (const tag of quote.tags ?? []) tags.add(tag);
	return [...tags].sort();
}

export function authorsOf(catalogue: TpQuoteCatalogue): string[] {
	const authors = new Set<string>();
	for (const quote of catalogue.quotes) {
		const name = attributionOf(quote);
		if (name !== '') authors.add(name);
	}
	return [...authors].sort((a, b) => a.localeCompare(b));
}

export interface TpQuoteFilter {
	query?: string;
	tag?: string;
	author?: string;
	favouritesOnly?: boolean;
}

/**
 * Browse and search (doc 08 §3). Diacritic-folded through the same helper the
 * widget drawer uses, so `dong` finds `đồng` — typing Vietnamese with its marks
 * to filter a list is a chore nobody should have to do.
 *
 * The query is matched against **both** languages regardless of locale. A
 * reader who remembers a quote in English and is reading in Vietnamese should
 * still find it; there is one dataset and no reason to hide half of it.
 */
export function filterQuotes(
	catalogue: TpQuoteCatalogue,
	filter: TpQuoteFilter,
	favourites: readonly string[] = []
): TpQuote[] {
	const needle = foldForSearch(filter.query?.trim() ?? '');
	const favouriteSet = new Set(favourites);

	return catalogue.quotes.filter((quote) => {
		if (filter.favouritesOnly === true && !favouriteSet.has(quote.id)) return false;
		if (filter.tag !== undefined && !(quote.tags ?? []).includes(filter.tag)) return false;
		if (filter.author !== undefined && attributionOf(quote) !== filter.author) return false;
		if (needle === '') return true;

		const haystack = foldForSearch(
			`${quote.vi ?? ''} ${quote.en ?? ''} ${attributionOf(quote)} ${quote.work ?? ''}`
		);
		return haystack.includes(needle);
	});
}

/* ─────────────────────────────────────────────────────────────── settings */

export function readSettings(bag: Record<string, unknown>): TpQuoteSettings {
	const stored = bag['favourites'];
	return {
		favourites: Array.isArray(stored)
			? stored
					.filter((value): value is string => typeof value === 'string')
					.slice(0, FAVOURITES_MAX)
			: []
	};
}

/**
 * Newest first, capped. Un-favouriting removes; favouriting a full list drops
 * the oldest rather than refusing, because a cap the user has to manage is a
 * cap that gets in the way of the feature it protects.
 */
export function toggleFavourite(favourites: readonly string[], id: string): string[] {
	if (favourites.includes(id)) return favourites.filter((entry) => entry !== id);
	return [id, ...favourites].slice(0, FAVOURITES_MAX);
}
