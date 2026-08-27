#!/usr/bin/env node
/**
 * `pnpm i18n:audit` — doc 14 §2's hardcoded-string ban.
 *
 * Flags visible text in `.svelte` markup that is not the result of an `m.*()`
 * call. Report-only through Week 1 so the backlog stayed visible and shrinking
 * rather than arriving in one lump; **CI-blocking from Week 2** (doc 14 §4),
 * which is what the flipped default below now means. `--report-only` restores
 * the Week 1 behaviour for a local sweep. The flag is spelled that way round,
 * rather than the `--strict` doc 14 §2 first proposed, so this gate and
 * `tokens-audit.mjs` share one convention instead of being each other's
 * opposite — a gate you have to remember the polarity of is a gate that gets
 * invoked wrong.
 *
 * It walks the template AST via `svelte/compiler` rather than grepping. svelte
 * is already a dependency, and the false-positive rate of a regex over Svelte
 * markup is precisely what would get a script like this switched off.
 */

import { globSync, readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';

const STRICT = !process.argv.includes('--report-only');

const INCLUDE = 'src/**/*.svelte';
const EXCLUDE = [/^src[\\/]routes[\\/]spike[\\/]/, /^src[\\/]lib[\\/]paraglide[\\/]/];

/** Attributes whose literal values a user actually reads or hears. */
const VISIBLE_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'alt', 'aria-description']);

/** Punctuation, symbols and digits carry no language. */
const HAS_LETTERS = /\p{L}/u;

/**
 * Text that is the same in every locale by definition: the product name, and
 * the endonyms on the gate's language switch — "English" is not translated into
 * Vietnamese on a language picker, that is the whole point of an endonym.
 */
const PROPER_NOUNS = new Set(['TilePier', 'Tiếng Việt', 'English']);

const IGNORE_COMMENT = 'i18n-audit-ignore';

const findings = [];

function record(file, line, text) {
	findings.push({ file, line, text: text.trim().replace(/\s+/g, ' ').slice(0, 60) });
}

function lineOf(source, index) {
	return source.slice(0, index).split('\n').length;
}

/** `visit` returns false to stop descending — attributes own their own text. */
function walk(node, visit) {
	if (node === null || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const child of node) walk(child, visit);
		return;
	}
	if (typeof node.type === 'string' && visit(node) === false) return;
	for (const [key, value] of Object.entries(node)) {
		if (key === 'type' || key === 'parent') continue;
		walk(value, visit);
	}
}

const files = globSync(INCLUDE).filter((file) => !EXCLUDE.some((rx) => rx.test(file)));

for (const file of files) {
	const source = readFileSync(file, 'utf8');

	// A file-level escape hatch, used by the doc 14 §6 dual-render blocks where
	// literal prose is the point.
	if (source.includes(IGNORE_COMMENT)) continue;

	let ast;
	try {
		ast = parse(source, { modern: true, filename: file });
	} catch (error) {
		console.error(`  ${file}: could not parse (${error.message})`);
		continue;
	}

	walk(ast.fragment, (node) => {
		// Attribute values are full of class names, test ids and element types.
		// Only the handful a user actually reads count, and the rest of the
		// subtree must not be mistaken for template text.
		if (node.type === 'Attribute' || node.type === 'SpreadAttribute') {
			if (node.type === 'Attribute' && VISIBLE_ATTRS.has(node.name)) {
				for (const part of Array.isArray(node.value) ? node.value : []) {
					if (part?.type === 'Text' && HAS_LETTERS.test(part.data)) {
						record(file, lineOf(source, node.start ?? 0), `${node.name}="${part.data}"`);
					}
				}
			}
			return false;
		}
		if (node.type === 'Text' && typeof node.data === 'string' && HAS_LETTERS.test(node.data)) {
			if (!PROPER_NOUNS.has(node.data.trim())) {
				record(file, lineOf(source, node.start ?? 0), node.data);
			}
		}
		return true;
	});
}

if (findings.length === 0) {
	console.log(`i18n:audit — ${files.length} components, no hardcoded strings.`);
	process.exit(0);
}

for (const { file, line, text } of findings) {
	console.log(`  ${file}:${line}  ${text}`);
}
console.log(`\ni18n:audit found ${findings.length} hardcoded string(s) in ${files.length} files.`);

if (STRICT) process.exit(1);
