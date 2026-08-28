import { describe, expect, it } from 'vitest';
import {
	attributionOf,
	authorsOf,
	bilingualPool,
	FAVOURITES_MAX,
	filterQuotes,
	loadCatalogue,
	pickOfDay,
	quoteText,
	readSettings,
	tagsOf,
	toggleFavourite,
	type TpQuote,
	type TpQuoteCatalogue
} from './service';

/**
 * doc 08 §3's data layer, and the bundled dataset itself.
 *
 * The dataset is checked here as well as the code, because it is generated from
 * a sibling repository by a script nobody runs in CI — so the only thing
 * standing between a bad re-import and a shipped licence breach is this file.
 */

const catalogue = await loadCatalogue();

const quote = (overrides: Partial<TpQuote> = {}): TpQuote => ({
	id: 'q1',
	vi: 'một',
	en: 'one',
	rights: 'public-domain',
	...overrides
});

const fake = (quotes: TpQuote[]): TpQuoteCatalogue => ({
	version: 1,
	source: 'test',
	counts: { total: quotes.length, bilingual: 0, viOnly: 0, enOnly: 0 },
	quotes
});

describe('the bundled dataset', () => {
	it('carries only rights doc 16 §1 allows', () => {
		// The licence gate, held at runtime as well as at import time. Anything
		// `quoted-with-attribution` here is a shipped breach.
		const allowed = new Set(['cc0', 'public-domain', 'own-translation']);
		const bad = catalogue.quotes.filter((entry) => !allowed.has(entry.rights));
		expect(bad.map((entry) => entry.id)).toEqual([]);
	});

	it('does not contain the entries the import excludes by name', () => {
		const ids = new Set(catalogue.quotes.map((entry) => entry.id));
		expect(ids.has('vi-0105')).toBe(false);
		expect(ids.has('en-0111')).toBe(false);
	});

	it('gives every entry an id, a right and at least one language', () => {
		for (const entry of catalogue.quotes) {
			expect(entry.id, JSON.stringify(entry)).toMatch(/^(vi|en)-\d+$/);
			expect(typeof entry.rights).toBe('string');
			expect(entry.vi ?? entry.en, entry.id).toBeDefined();
		}
	});

	it('has no duplicate ids', () => {
		const ids = catalogue.quotes.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('reports counts that match its own contents', () => {
		expect(catalogue.counts.total).toBe(catalogue.quotes.length);
		expect(catalogue.counts.bilingual).toBe(bilingualPool(catalogue).length);
	});

	it('is big enough for a daily pick not to repeat within a season', () => {
		// 284 bilingual entries is a nine-month cycle. Worth asserting, because
		// a re-import that silently halved the pool would still pass everything
		// else in this file.
		expect(bilingualPool(catalogue).length).toBeGreaterThan(250);
	});
});

describe('pickOfDay', () => {
	const pool = bilingualPool(catalogue);

	it('gives the same answer for the same date, every time', () => {
		expect(pickOfDay(pool, '2026-08-28')?.id).toBe(pickOfDay(pool, '2026-08-28')?.id);
	});

	it('is arithmetic, so two devices agree without sharing anything', () => {
		// The whole reason it is a hash of the date rather than a random draw:
		// every reader on 28 August lands on the same entry, offline.
		expect(pickOfDay(pool, '2026-08-28')?.id).toBe(pickOfDay([...pool], '2026-08-28')?.id);
	});

	it('moves from one day to the next', () => {
		const week = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'].map(
			(day) => pickOfDay(pool, day)?.id
		);
		expect(new Set(week).size).toBe(week.length);
	});

	it('spreads across the pool over a year rather than favouring a corner', () => {
		const seen = new Set<string>();
		for (let day = 1; day <= 365; day++) {
			const key = `2026-${String(Math.ceil(day / 31)).padStart(2, '0')}-${String((day % 28) + 1).padStart(2, '0')}`;
			seen.add(pickOfDay(pool, key)?.id ?? '');
		}
		// A hash that clustered would show up here as a small set.
		expect(seen.size).toBeGreaterThan(100);
	});

	it('always lands on an entry that exists in both languages', () => {
		// Which is what makes doc 08 §3's locale-switch edge case work at all.
		for (const day of ['2026-01-01', '2026-06-15', '2026-12-31', '2027-02-17']) {
			const picked = pickOfDay(pool, day);
			expect(picked?.vi, day).toBeDefined();
			expect(picked?.en, day).toBeDefined();
		}
	});

	it('returns null for an empty pool rather than throwing', () => {
		expect(pickOfDay([], '2026-08-28')).toBeNull();
	});
});

describe('quoteText', () => {
	it('reads the asked-for language', () => {
		expect(quoteText(quote(), 'vi')).toBe('một');
		expect(quoteText(quote(), 'en')).toBe('one');
	});

	it('falls back rather than rendering an empty line', () => {
		// Only reachable from browse, where the catalogue holds 46 en-only and
		// 56 vi-only entries. Showing the other language beats showing nothing.
		// Written as literals rather than through the helper: with
		// `exactOptionalPropertyTypes` (doc 20 §2) an absent field is a missing
		// key, not an `undefined` one, and `{ en: undefined }` is a type error.
		expect(quoteText({ id: 'q1', vi: 'một', rights: 'public-domain' }, 'en')).toBe('một');
		expect(quoteText({ id: 'q1', en: 'one', rights: 'public-domain' }, 'vi')).toBe('one');
	});
});

describe('attributionOf', () => {
	it('prefers the author', () => {
		expect(attributionOf(quote({ author: 'Emerson', source: 'x' }))).toBe('Emerson');
	});

	it('falls back to the source for a proverb, which has no author', () => {
		// Not a missing field — a proverb genuinely has no one to credit.
		expect(attributionOf(quote({ source: 'Tục ngữ Việt Nam' }))).toBe('Tục ngữ Việt Nam');
	});

	it('is empty when there is nothing to say', () => {
		expect(attributionOf(quote())).toBe('');
	});
});

describe('tagsOf and authorsOf', () => {
	it('reads the tags the dataset actually carries', () => {
		const tags = tagsOf(catalogue);
		expect(tags).toContain('perseverance');
		expect(tags).toContain('wisdom');
		expect(tags).toEqual([...tags].sort());
	});

	it('lists authors without duplicates', () => {
		const authors = authorsOf(catalogue);
		expect(new Set(authors).size).toBe(authors.length);
		expect(authors.length).toBeGreaterThan(50);
	});
});

describe('filterQuotes', () => {
	it('matches on either language, whatever the reader is using', () => {
		// One dataset, and no reason to hide half of it from someone who
		// remembers the other half.
		const both = fake([quote({ id: 'a', vi: 'kiên trì', en: 'perseverance' })]);
		expect(filterQuotes(both, { query: 'kiên' })).toHaveLength(1);
		expect(filterQuotes(both, { query: 'persever' })).toHaveLength(1);
	});

	it('folds diacritics, so typing without marks still finds it', () => {
		const both = fake([quote({ id: 'a', vi: 'đồng lòng' })]);
		expect(filterQuotes(both, { query: 'dong long' })).toHaveLength(1);
	});

	it('searches the attribution as well as the text', () => {
		const both = fake([quote({ id: 'a', author: 'Marcus Aurelius' })]);
		expect(filterQuotes(both, { query: 'aurelius' })).toHaveLength(1);
	});

	it('filters by tag and by author', () => {
		const some = fake([
			quote({ id: 'a', tags: ['wisdom'], author: 'Seneca' }),
			quote({ id: 'b', tags: ['courage'], author: 'Seneca' }),
			quote({ id: 'c', tags: ['wisdom'], author: 'Epictetus' })
		]);
		expect(filterQuotes(some, { tag: 'wisdom' }).map((q) => q.id)).toEqual(['a', 'c']);
		expect(filterQuotes(some, { author: 'Seneca' }).map((q) => q.id)).toEqual(['a', 'b']);
		expect(filterQuotes(some, { tag: 'wisdom', author: 'Seneca' }).map((q) => q.id)).toEqual(['a']);
	});

	it('narrows to favourites when asked', () => {
		const some = fake([quote({ id: 'a' }), quote({ id: 'b' })]);
		expect(filterQuotes(some, { favouritesOnly: true }, ['b']).map((q) => q.id)).toEqual(['b']);
	});

	it('returns everything for an empty query', () => {
		expect(filterQuotes(catalogue, {})).toHaveLength(catalogue.quotes.length);
		expect(filterQuotes(catalogue, { query: '   ' })).toHaveLength(catalogue.quotes.length);
	});

	it('finds nothing for a query nothing matches, rather than everything', () => {
		expect(filterQuotes(catalogue, { query: 'zzzzqqqq' })).toEqual([]);
	});
});

describe('favourites', () => {
	it('reads an absent list as empty', () => {
		expect(readSettings({}).favourites).toEqual([]);
	});

	it('drops entries that are not ids', () => {
		expect(readSettings({ favourites: ['a', 3, null, 'b'] }).favourites).toEqual(['a', 'b']);
	});

	it('survives a favourites that is not a list', () => {
		expect(readSettings({ favourites: 'a' }).favourites).toEqual([]);
	});

	it('caps a list that has grown past the limit', () => {
		const long = Array.from({ length: FAVOURITES_MAX + 50 }, (_v, i) => `q${String(i)}`);
		expect(readSettings({ favourites: long }).favourites).toHaveLength(FAVOURITES_MAX);
	});

	it('adds to the front and removes on a second toggle', () => {
		expect(toggleFavourite(['b'], 'a')).toEqual(['a', 'b']);
		expect(toggleFavourite(['a', 'b'], 'a')).toEqual(['b']);
	});

	it('drops the oldest rather than refusing when full', () => {
		// A cap the user has to manage is a cap that gets in the way of the
		// feature it protects.
		const full = Array.from({ length: FAVOURITES_MAX }, (_v, i) => `q${String(i)}`);
		const next = toggleFavourite(full, 'new');
		expect(next).toHaveLength(FAVOURITES_MAX);
		expect(next[0]).toBe('new');
		expect(next).not.toContain(`q${String(FAVOURITES_MAX - 1)}`);
	});

	it('does not mutate what it was given', () => {
		const input = ['a'];
		toggleFavourite(input, 'b');
		expect(input).toEqual(['a']);
	});
});
