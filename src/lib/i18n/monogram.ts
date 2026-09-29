/**
 * The letter a thing is shown by when it has no picture of its own: the first
 * letter or digit of its name, upper-cased for the reader's locale — a feed
 * without a favicon (doc 08 §4, where it began), a song without a cover (doc
 * 09 §2, its second use, which is when it moved here from the rss widget).
 *
 * Leading punctuation is skipped, so «Đời sống» is Đ; a name with no letter or
 * digit at all is `#`. `toLocaleUpperCase` because upper-casing is not
 * locale-neutral: Turkish ı is I, and doc 14 wants the reader's rules.
 */
export function monogramOf(name: string, locale: string): string {
	const first = Array.from(name.replace(/^[^\p{L}\p{N}]+/u, ''))[0];
	return first === undefined ? '#' : first.toLocaleUpperCase(locale);
}
