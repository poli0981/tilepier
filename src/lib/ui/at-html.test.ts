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
 * Comments are blanked first, so a component explaining why it does *not* use
 * `{@html}` does not count against the rule.
 */

const ALLOWED = ['src/lib/ui/TpFeedHtml.svelte', 'src/lib/ui/TpMarkdown.svelte'];

function uses(file: string): number {
	const source = readFileSync(file, 'utf8')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
	return source.match(/\{@html\s/g)?.length ?? 0;
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

	it('says, beside each one, which sanitiser it trusts', () => {
		for (const file of ALLOWED) {
			const source = readFileSync(file, 'utf8');
			expect(source, file).toMatch(
				/SAFETY:[\s\S]*core\/sanitize\.ts|SAFETY:[\s\S]*core\/markdown\.ts/
			);
		}
	});
});
