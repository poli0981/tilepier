/**
 * Search normalisation.
 *
 * Vietnamese is the base locale, and typing `đồng hồ` with its diacritics to
 * filter a list of five widgets is a chore nobody should have to do. Folding
 * both the query and the candidate makes `dong ho` find `Đồng hồ` without the
 * search box needing to know which language it is looking at.
 *
 * `đ`/`Đ` needs its own rule: it is a distinct letter, not `d` with a mark, so
 * NFD leaves it whole where every other Vietnamese diacritic decomposes.
 */
const COMBINING_MARKS = /[̀-ͯ]/g;

export function foldForSearch(value: string): string {
	return value.normalize('NFD').replace(COMBINING_MARKS, '').replace(/đ/gi, 'd').toLowerCase();
}
