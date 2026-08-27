import { describe, expect, it } from 'vitest';
import type { TpNote } from '$lib/core/storage/db';
import { resolveVisible, searchNotes, titleOf } from './service';

/**
 * doc 07 §4's pure half. The Dexie half is in `storage.svelte.test.ts`, which
 * runs in the browser project against a throwaway database.
 */

function note(overrides: Partial<TpNote> = {}): TpNote {
	return { id: 'note_1', title: '', body: '', updatedAt: 0, ...overrides };
}

describe('titleOf', () => {
	it('takes the first line that has something on it', () => {
		expect(titleOf('Shopping\nmilk\nbread')).toBe('Shopping');
		expect(titleOf('\n\n  Later thoughts\nand more')).toBe('Later thoughts');
	});

	it('strips the heading marks a markdown title carries', () => {
		expect(titleOf('# Shopping')).toBe('Shopping');
		expect(titleOf('### Deep heading')).toBe('Deep heading');
		// Seven hashes is not a heading in markdown, and is not treated as one.
		expect(titleOf('####### Not a heading')).toBe('# Not a heading');
	});

	it('is empty for an empty note rather than inventing something', () => {
		// The UI shows "untitled"; that is a display decision, not a data one.
		expect(titleOf('')).toBe('');
		expect(titleOf('\n\n   \n')).toBe('');
	});

	it('caps a very long first line', () => {
		expect(titleOf('x'.repeat(200)).length).toBe(80);
	});

	it('keeps Vietnamese diacritics intact', () => {
		expect(titleOf('# Ghi chú của tôi')).toBe('Ghi chú của tôi');
	});
});

describe('searchNotes', () => {
	const notes = [
		note({ id: 'a', title: 'Shopping', body: 'milk and bread' }),
		note({ id: 'b', title: 'Ghi chú', body: 'họp lúc ba giờ' }),
		note({ id: 'c', title: 'Ideas', body: 'a better mousetrap' })
	];

	it('matches the title and the body, as doc 07 §4 asks', () => {
		expect(searchNotes(notes, 'Shopping').map((entry) => entry.id)).toEqual(['a']);
		expect(searchNotes(notes, 'mousetrap').map((entry) => entry.id)).toEqual(['c']);
	});

	it('ignores case', () => {
		expect(searchNotes(notes, 'SHOPPING').map((entry) => entry.id)).toEqual(['a']);
	});

	it('ignores Vietnamese diacritics on both sides', () => {
		// Typing your own search term with its marks is a chore nobody should
		// have to do (src/lib/i18n/fold.ts).
		expect(searchNotes(notes, 'ghi chu').map((entry) => entry.id)).toEqual(['b']);
		expect(searchNotes(notes, 'hop luc').map((entry) => entry.id)).toEqual(['b']);
	});

	it('returns everything for an empty or whitespace query', () => {
		expect(searchNotes(notes, '')).toHaveLength(3);
		expect(searchNotes(notes, '   ')).toHaveLength(3);
	});

	it('returns a copy rather than the array it was handed', () => {
		// The caller filters and sorts this; handing back the original would let
		// a sort reorder the store's own list.
		expect(searchNotes(notes, '')).not.toBe(notes);
	});

	it('finds nothing when nothing matches', () => {
		expect(searchNotes(notes, 'zzzz')).toEqual([]);
	});
});

describe('resolveVisible', () => {
	const notes = [note({ id: 'newest', updatedAt: 3 }), note({ id: 'older', updatedAt: 1 })];

	it('shows the pinned note when it still exists', () => {
		expect(resolveVisible(notes, 'older')?.id).toBe('older');
	});

	it('falls back to the most recent when the pinned note is gone', () => {
		// doc 07 §4's edge case. The list arrives newest-first from listNotes().
		expect(resolveVisible(notes, 'deleted')?.id).toBe('newest');
	});

	it('shows the most recent when nothing is pinned', () => {
		expect(resolveVisible(notes, undefined)?.id).toBe('newest');
		expect(resolveVisible(notes, 42)?.id).toBe('newest');
	});

	it('has nothing to show when there are no notes', () => {
		expect(resolveVisible([], 'anything')).toBeNull();
	});
});
