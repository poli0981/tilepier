#!/usr/bin/env node
/**
 * `pnpm i18n:check` — doc 14 §4.
 *
 * Fails on drift between the two message catalogues. CI-blocking from Week 1:
 * it is deterministic, sub-second, and has no false positives, so there is no
 * reason to let a half-translated key ship.
 *
 * Exit 0 clean, exit 1 on any finding, one line per finding.
 */

import { readFileSync, existsSync } from 'node:fs';

const BASE_LOCALE = 'vi';
const LOCALES = ['vi', 'en'];

/** doc 14 §2: shared strings under `common.*`, a widget owns `widget.<id>.*`. */
const NAMESPACES = ['common', 'widget', 'settings', 'legal', 'error'];

const findings = [];

function fail(message) {
	findings.push(message);
}

function load(locale) {
	const path = `messages/${locale}.json`;
	if (!existsSync(path)) {
		fail(`${path} is missing`);
		return {};
	}
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8'));
		// The catalogue carries a $schema pointer; it is not a message.
		delete parsed.$schema;
		return parsed;
	} catch (error) {
		fail(`${path} is not valid JSON: ${error.message}`);
		return {};
	}
}

/** `{name}` placeholders, as a sorted set so order differences are not drift. */
function placeholders(value) {
	return [...String(value).matchAll(/\{([^}]+)\}/g)].map((m) => m[1].trim()).sort();
}

const catalogues = new Map(LOCALES.map((locale) => [locale, load(locale)]));
const base = catalogues.get(BASE_LOCALE) ?? {};

// 1 · key-set symmetry, reported in both directions
for (const locale of LOCALES) {
	if (locale === BASE_LOCALE) continue;
	const other = catalogues.get(locale) ?? {};
	for (const key of Object.keys(base)) {
		if (!(key in other)) fail(`${locale}: missing key "${key}" (present in ${BASE_LOCALE})`);
	}
	for (const key of Object.keys(other)) {
		if (!(key in base)) fail(`${BASE_LOCALE}: missing key "${key}" (present in ${locale})`);
	}
}

// 2 · empty values — a key that exists but says nothing is not a translation
for (const [locale, messages] of catalogues) {
	for (const [key, value] of Object.entries(messages)) {
		if (typeof value !== 'string') {
			fail(`${locale}: "${key}" is not a string`);
		} else if (value.trim() === '') {
			fail(`${locale}: "${key}" is empty`);
		}
	}
}

// 3 · placeholder parity — the check that actually catches a broken translation
for (const locale of LOCALES) {
	if (locale === BASE_LOCALE) continue;
	const other = catalogues.get(locale) ?? {};
	for (const [key, value] of Object.entries(base)) {
		if (!(key in other)) continue;
		const expected = placeholders(value);
		const actual = placeholders(other[key]);
		if (expected.join('|') !== actual.join('|')) {
			fail(
				`${locale}: "${key}" placeholders {${actual.join(', ')}} ` +
					`do not match ${BASE_LOCALE} {${expected.join(', ')}}`
			);
		}
	}
}

// 4 · naming — dot-namespaced, and inside a namespace doc 14 §2 allows
for (const key of Object.keys(base)) {
	if (!key.includes('.')) {
		fail(`"${key}" is not dot-namespaced (doc 14 §2)`);
		continue;
	}
	const namespace = key.split('.')[0];
	if (!NAMESPACES.includes(namespace)) {
		fail(`"${key}" uses namespace "${namespace}"; allowed: ${NAMESPACES.join(', ')}`);
	}
}

// 5 · every registered widget manifest has its title and blurb (doc 06 §1)
const registryPath = 'src/lib/core/registry.ts';
if (existsSync(registryPath)) {
	const source = readFileSync(registryPath, 'utf8');
	for (const match of source.matchAll(/i18nKey:\s*'(widget\.[a-z]+)'/g)) {
		for (const suffix of ['title', 'blurb']) {
			const key = `${match[1]}.${suffix}`;
			if (!(key in base)) fail(`registry declares ${match[1]} but "${key}" is missing`);
		}
	}
}

if (findings.length > 0) {
	for (const finding of findings) {
		console.error(process.env['CI'] ? `::error::i18n: ${finding}` : `  ${finding}`);
	}
	console.error(`\ni18n:check found ${findings.length} problem(s).`);
	process.exit(1);
}

const count = Object.keys(base).length;
console.log(`i18n:check — ${count} keys, ${LOCALES.length} locales, no drift.`);
