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
 * **And a second rule, since 2026-09-25: every `var(--name)` must name one of
 * this project's tokens.** A `var()` of an undefined property is not an error
 * in CSS — the declaration becomes invalid at computed-value time and falls
 * back to inheriting, or to nothing at all — so an imagined token fails
 * silently. Two had, measured in the browser:
 *
 * - `--color-accent` was never defined, so every markets action rendered in
 *   the surrounding grey instead of the beacon, and every `outline` naming it
 *   was dropped whole — the controls' focus rings with it.
 * - `--color-ink-800` was never defined, so the currency detail's table had
 *   no row rules at all.
 *
 * Three more resolved only by accident: `--text-sm`, `--text-2xl` and
 * `--text-3xl` are Tailwind's defaults (14, 24 and 30 px), present because
 * `app.css` imports Tailwind without clearing that namespace — a second type
 * scale beside doc 12's, which nothing chose. So "defined" means defined *here*:
 * in `src/app.css`, in the same file (a component-local property, set in its
 * styles or through `style:--name`), or by a script's `setProperty`. The raw-hex
 * rule could see none of this, because none of it was hex.
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

/**
 * Valid CSS hex-colour lengths only: #rgb, #rgba, #rrggbb, #rrggbbaa — and not
 * followed by a word character or a hyphen, so `#fff` matches and `#fffx` or
 * `#fff-id` does not. `\w` already contains every hex digit; the class used to
 * spell them out as well, which CodeQL (js/overly-large-range) rightly read as
 * a range overlapping `\w`.
 */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;

/**
 * Same escape-hatch idea as `i18n-audit.mjs`, but line-scoped rather than
 * file-scoped: one legitimate colour must not switch off a whole component.
 * Honoured on the offending line or the line above it, because a long array
 * literal reads better with the exemption over it than trailing off the end.
 */
const IGNORE_COMMENT = 'tokens-audit-ignore';

/** `--name:` — a custom-property definition, which is what a token is. */
const DEFINES_TOKEN = /--[\w-]+\s*:/;

/** Every way a file can give a custom property a value: a declaration, a
 *  Svelte `style:--name` directive, or `setProperty('--name', …)`. */
const DEFINITIONS = [
	/(--[\w-]+)\s*:/g,
	/style:(--[\w-]+)/g,
	/setProperty\(\s*['"`](--[\w-]+)['"`]/g
];

/** A reference, with or without a fallback — `var(--a, …)` still names `--a`. */
const REFERENCE = /var\(\s*(--[\w-]+)/g;

function definedIn(source) {
	const names = new Set();
	for (const pattern of DEFINITIONS) {
		for (const match of source.matchAll(pattern)) names.add(match[1]);
	}
	return names;
}

const findings = [];
const undefinedRefs = [];

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

/** What `app.css` defines, which every file may use. Read through
 *  `stripComments` so a commented-out token is not a token. */
const GLOBAL_TOKENS = definedIn(stripComments(readFileSync(TOKEN_SOURCE, 'utf8')));

// Scripts too: a component can set a property from TypeScript, and the rule
// has to see that before it can say a reference is dangling.
const SCRIPT_TOKENS = definedIn(
	globSync(['src/**/*.ts'])
		.map((file) => file.split(sep).join('/'))
		.filter((file) => !EXCLUDE.some((rx) => rx.test(file)))
		.map((file) => stripComments(readFileSync(file, 'utf8')))
		.join('\n')
);

for (const file of files) {
	const isTokenSource = file === TOKEN_SOURCE;
	const source = readFileSync(file, 'utf8');

	// Two views of the same file, and they cannot be collapsed into one: hex is
	// matched against the stripped text so a comment cannot trip the gate, while
	// the ignore marker is *itself* a comment and has to be read from the raw
	// text. Stripping first and then looking for the marker finds nothing, ever.
	const raw = source.split('\n');
	const stripped = stripComments(source).split('\n');

	const local = definedIn(stripped.join('\n'));
	stripped.forEach((line, index) => {
		for (const match of line.matchAll(REFERENCE)) {
			const name = match[1];
			if (GLOBAL_TOKENS.has(name) || SCRIPT_TOKENS.has(name) || local.has(name)) continue;
			undefinedRefs.push({ file, line: index + 1, text: name });
		}
	});

	stripped.forEach((line, index) => {
		if (isTokenSource && DEFINES_TOKEN.test(line)) return;
		if ((raw[index] ?? '').includes(IGNORE_COMMENT)) return;
		if ((raw[index - 1] ?? '').includes(IGNORE_COMMENT)) return;

		for (const match of line.matchAll(HEX)) {
			findings.push({ file, line: index + 1, text: match[0] });
		}
	});
}

if (findings.length === 0 && undefinedRefs.length === 0) {
	console.log(
		`tokens:audit — ${files.length} files, no raw hex outside the token source, no undefined tokens.`
	);
	process.exit(0);
}

for (const { file, line, text } of findings) {
	console.error(
		process.env['CI']
			? `::error file=${file},line=${line}::tokens: raw hex ${text} — use a var(--color-*) token (doc 20 §1)`
			: `  ${file}:${line}  ${text}`
	);
}
for (const { file, line, text } of undefinedRefs) {
	console.error(
		process.env['CI']
			? `::error file=${file},line=${line}::tokens: var(${text}) names no token, so the property silently inherits (doc 20 §1)`
			: `  ${file}:${line}  var(${text}) is not defined`
	);
}
if (findings.length > 0) console.error(`\ntokens:audit found ${findings.length} raw hex value(s).`);
if (undefinedRefs.length > 0) {
	console.error(`\ntokens:audit found ${undefinedRefs.length} reference(s) to undefined tokens.`);
}

if (STRICT) process.exit(1);
