import { globSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * doc 15 §4 and CLAUDE.md rule 7, as a count.
 *
 * There are exactly two `{@html}` in the app, one per sanitiser profile, and
 * each sits inside a component that takes its *input* — markdown source, a
 * feed's raw summary — and runs the pipeline itself, so nothing outside can
 * hand it HTML that skipped the sanitiser. doc 23 recorded "one `{@html}`, keep
 * it that way" in Week 3; the reader of Week 6 needed the second, and this is
 * what keeps a third from arriving as quietly as `svelte/no-at-html-tags` can
 * be disabled for a line.
 *
 * Only markup counts, so a component explaining why it does *not* use
 * `{@html}` — in a script comment or a markup one — does not count against
 * the rule.
 */

const ALLOWED = ['src/lib/ui/TpFeedHtml.svelte', 'src/lib/ui/TpMarkdown.svelte'];

/**
 * A component's markup, as the Svelte parser reads it: `<script>` and
 * `<style>` blocks are skipped whole (nothing in them is markup, so a
 * `{@html` there is a string or a comment), and so are `<!-- -->` comments, the
 * only comment markup has. One pass, left to right.
 *
 * Third version. A `replace` per comment syntax left a fresh `<!--` behind in
 * `<!<!-- -->-- x -->` (CodeQL js/incomplete-multi-character-sanitization,
 * alert #6); repeating them until nothing changed was alert #7, and wrong as
 * well: removing one comment can join the text around it into something shaped
 * like another, and the loop removed that too, though no parser would. Both
 * also took `//` for a comment everywhere, so `href="//x">{@html y}` hid a
 * live `{@html` from the count. A scan never reads its own output, and in
 * markup `//` is text.
 */
function markup(source: string): string {
	let text = '';
	let index = 0;
	while (index < source.length) {
		const skip = skipped(source, index);
		if (skip === null) {
			text += source[index];
			index += 1;
			continue;
		}
		const end = source.indexOf(skip.close, index + skip.open);
		index = end === -1 ? source.length : end + skip.close.length;
	}
	return text;
}

/** What starts at `index` and is not markup: its opener's length and its closer. */
function skipped(source: string, index: number): { open: number; close: string } | null {
	if (source.startsWith('<!--', index)) return { open: 4, close: '-->' };
	const block = /^<(script|style)[\s>]/.exec(source.slice(index, index + 8));
	return block ? { open: block[0].length, close: `</${block[1]}>` } : null;
}

function uses(file: string): number {
	return markup(readFileSync(file, 'utf8')).match(/\{@html\s/g)?.length ?? 0;
}

describe('{@html} (doc 15 §4)', () => {
	const files = globSync('src/**/*.svelte')
		.map((file) => file.split(sep).join('/'))
		.filter((file) => !file.startsWith('src/lib/paraglide/'));

	it('appears in exactly the two sanitising components, once each', () => {
		const found = files
			.map((file) => ({ file, count: uses(file) }))
			.filter(({ count }) => count > 0)
			.sort((a, b) => a.file.localeCompare(b.file));

		expect(found).toEqual(ALLOWED.map((file) => ({ file, count: 1 })));
	});

	it('reads markup as the parser does, and nothing else as markup', () => {
		expect(markup('a <!-- {@html x} --> b')).toBe('a  b');
		expect(markup('<script lang="ts">\n\t// {@html x}\n</script>ok')).toBe('ok');
		expect(markup('<script module>/* {@html x} */</script>ok')).toBe('ok');
		expect(markup('<style>/* {@html x} */</style>ok')).toBe('ok');
		// The one comment here is `<!-- -->`; what follows it is text, and live.
		// The replace loop this replaced called it a comment too.
		expect(markup('<!<!-- -->-- {@html x} -->')).toContain('{@html');
		// In markup, `//` is text — a protocol-relative link is not a comment.
		expect(markup('<a href="//example.com">{@html x}</a>')).toContain('{@html');
		// A component is not a script block.
		expect(markup('<Scripts>{@html x}</Scripts>')).toContain('{@html');
	});

	it('says, beside each one, which sanitiser it trusts', () => {
		for (const file of ALLOWED) {
			const source = readFileSync(file, 'utf8');
			expect(source, file).toMatch(
				/SAFETY:[\s\S]*core\/sanitize\.ts|SAFETY:[\s\S]*core\/markdown\.ts/
			);
		}
	});
});
