#!/usr/bin/env node
/**
 * `pnpm tokens:audit` — doc 20 §1's "design tokens only via `@theme` variables;
 * raw hex in components is lint-flagged by a grep script".
 *
 * CI-blocking from Week 2, the same way `i18n:audit --strict` is: the backlog
 * was zero when the gate was written, so there is nothing to phase in.
 *
 * The rule it enforces, stated precisely:
 *
 *   `src/app.css` may write hex, but **only on a line that defines a CSS
 *   custom property**. That is what the `@theme` block and the light-theme
 *   mirror do, and it is the one place doc 12 §2 puts colour values.
 *   Everywhere else — every `.svelte` and every other `.css` — a hex literal
 *   is a finding, because the token it should have used already exists.
 *
 * Deliberately line-based rather than AST-based, unlike `i18n-audit.mjs`. A
 * colour can appear in a `<style>` block, in an inline `style=` attribute, or
 * in a script constant, and the three would need three different walkers to
 * find what one regex sees. Doc 20 §1 asks for a grep script; this is one,
 * with comments stripped so a doc reference in prose cannot trip it.
 */

import { globSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';

const STRICT = !process.argv.includes('--report-only');

const INCLUDE = ['src/**/*.svelte', 'src/**/*.css'];
const EXCLUDE = [/^src\/lib\/paraglide\//, /^src\/routes\/spike\//];

/** The one file allowed to name colours, and only where it defines a token. */
const TOKEN_SOURCE = 'src/app.css';

/** Valid CSS hex-colour lengths only: #rgb, #rgba, #rrggbb, #rrggbbaa. */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F\w-])/g;

/**
 * Same escape-hatch idea as `i18n-audit.mjs`, but line-scoped rather than
 * file-scoped: one legitimate colour must not switch off a whole component.
 * Honoured on the offending line or the line above it, because a long array
 * literal reads better with the exemption over it than trailing off the end.
 */
const IGNORE_COMMENT = 'tokens-audit-ignore';

/** `--name:` — a custom-property definition, which is what a token is. */
const DEFINES_TOKEN = /--[\w-]+\s*:/;

const findings = [];

/**
 * Blanks out comment bodies rather than deleting them, so line numbers survive.
 * Both syntaxes matter: the block form for stylesheets and script blocks alike,
 * and the double-slash form for the script block — doc 12 §2's own prose cites
 * #46D5C8 in a comment, and a gate that fires on its own documentation is a
 * gate someone switches off.
 */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
		.replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));
}

// node:fs globSync returns platform separators — backslashes on Windows. Every
// path below is compared against a literal and printed into a GitHub
// annotation, and both want forward slashes, so normalise once here through
// path.sep rather than spelling an escaped separator into three regexes and
// getting one of them wrong.
const files = globSync(INCLUDE)
	.map((file) => file.split(sep).join('/'))
	.filter((file) => !EXCLUDE.some((rx) => rx.test(file)))
	.sort();

for (const file of files) {
	const isTokenSource = file === TOKEN_SOURCE;
	const source = readFileSync(file, 'utf8');

	// Two views of the same file, and they cannot be collapsed into one: hex is
	// matched against the stripped text so a comment cannot trip the gate, while
	// the ignore marker is *itself* a comment and has to be read from the raw
	// text. Stripping first and then looking for the marker finds nothing, ever.
	const raw = source.split('\n');
	const stripped = stripComments(source).split('\n');

	stripped.forEach((line, index) => {
		if (isTokenSource && DEFINES_TOKEN.test(line)) return;
		if ((raw[index] ?? '').includes(IGNORE_COMMENT)) return;
		if ((raw[index - 1] ?? '').includes(IGNORE_COMMENT)) return;

		for (const match of line.matchAll(HEX)) {
			findings.push({ file, line: index + 1, text: match[0] });
		}
	});
}

if (findings.length === 0) {
	console.log(`tokens:audit — ${files.length} files, no raw hex outside the token source.`);
	process.exit(0);
}

for (const { file, line, text } of findings) {
	console.error(
		process.env['CI']
			? `::error file=${file},line=${line}::tokens: raw hex ${text} — use a var(--color-*) token (doc 20 §1)`
			: `  ${file}:${line}  ${text}`
	);
}
console.error(`\ntokens:audit found ${findings.length} raw hex value(s).`);

if (STRICT) process.exit(1);
