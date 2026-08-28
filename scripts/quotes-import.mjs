/**
 * Builds `src/lib/widgets/quote/data/quotes.json` from QuoteAtlas's dataset.
 *
 * Run by hand, not in CI — the source is a sibling repository, not a
 * dependency. `node scripts/quotes-import.mjs [path-to-quoteatlas]`.
 *
 * **This is doc 16 §1's per-entry re-audit, made mechanical.** That section
 * allows only CC0, public-domain and owned entries to be bundled, so anything
 * marked `quoted-with-attribution` is a hard failure here rather than a filter:
 * a filter would quietly drop a line and leave nobody any wiser about how many
 * were dropped or why. The run prints the tally and refuses to write.
 *
 * The output is one merged bilingual file rather than one per locale. Two files
 * would ship less to an English reader, but the daily pick has to land on the
 * same *id* in both languages (doc 08 §3's edge case), which means both sides
 * need the same pool — and the pool is the expensive half. One file, one
 * dynamic import, one source of truth about which entries are bilingual.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SOURCE = process.argv[2] ?? 'E:/qoute';
const OUT = 'src/lib/widgets/quote/data/quotes.json';

/** doc 16 §1: only these may be bundled. */
const ALLOWED_RIGHTS = new Set(['cc0', 'public-domain', 'own-translation']);

/**
 * Entries left out on purpose, each named with its reason.
 *
 * By id rather than by rights, and that is the whole design: filtering on
 * `rights === 'quoted-with-attribution'` would silently absorb whatever
 * upstream adds next, while an id list means a *new* quoted entry still stops
 * the run and gets looked at. Which is what doc 16 §1's "re-audit each entry"
 * asks for, done once and then held.
 */
const EXCLUDED = new Map([
	['vi-0105', 'Will Durant, Story of Philosophy 1926 — in copyright until 2052'],
	['en-0111', 'Will Durant, Story of Philosophy 1926 — in copyright until 2052']
]);

function load(locale) {
	const path = join(SOURCE, 'data', 'quotes', `${locale}.json`);
	return JSON.parse(readFileSync(path, 'utf8')).quotes;
}

const vi = load('vi');
const en = load('en');

/* ── the audit ── */

const refused = [];
const unknown = [];
for (const [locale, rows] of [
	['vi', vi],
	['en', en]
]) {
	for (const row of rows) {
		const rights = row.attribution?.rights;
		if (EXCLUDED.has(row.id)) continue;
		if (rights === 'quoted-with-attribution') {
			refused.push(`${locale}/${row.id} — ${row.attribution?.author ?? '(no author)'}`);
		} else if (!ALLOWED_RIGHTS.has(rights)) {
			unknown.push(`${locale}/${row.id} — rights: ${String(rights)}`);
		}
	}
}

console.log(`read ${String(vi.length)} vi and ${String(en.length)} en entries`);
for (const [id, reason] of EXCLUDED) console.log(`  excluded ${id}: ${reason}`);

if (unknown.length > 0) {
	console.error(`\n${String(unknown.length)} entries carry rights this script does not know:`);
	for (const line of unknown) console.error(`  ${line}`);
	console.error('\ndoc 16 §1 allows only cc0, public-domain and own-translation.');
	process.exit(1);
}

if (refused.length > 0) {
	console.error(`\n${String(refused.length)} entries are quoted-with-attribution:`);
	for (const line of refused) console.error(`  ${line}`);
	console.error(
		'\ndoc 16 §1 allows only CC0/public-domain/owned entries to be bundled.\n' +
			'Remove them at the source, or decide deliberately to carry the attribution\n' +
			'obligation and amend doc 16 §1 first. This script will not filter silently.'
	);
	process.exit(1);
}

/* ── the merge ── */

/** vi records carry `translations.en`, which is the only bilingual link that
 *  covers more than the id-map's overlap (143 against 141). */
const merged = new Map();

function attribution(row) {
	const a = row.attribution ?? {};
	const out = {};
	if (typeof a.author === 'string' && a.author !== '') out.author = a.author;
	if (typeof a.work === 'string' && a.work !== '') out.work = a.work;
	if (typeof a.source === 'string' && a.source !== '') out.source = a.source;
	if (typeof a.year === 'number') out.year = a.year;
	out.rights = a.rights;
	return out;
}

for (const row of vi) {
	if (EXCLUDED.has(row.id)) continue;
	const entry = { id: row.id, vi: row.text, ...attribution(row) };
	const translated = row.translations?.en;
	if (typeof translated === 'string' && translated !== '') entry.en = translated;
	if (Array.isArray(row.tags) && row.tags.length > 0) entry.tags = row.tags;
	merged.set(row.id, entry);
}

for (const row of en) {
	// An en record whose vi counterpart already carries this text is a
	// duplicate; only the ones with no bilingual partner earn their own entry.
	if (EXCLUDED.has(row.id)) continue;
	const translated = row.translations?.vi;
	const entry = { id: row.id, en: row.text, ...attribution(row) };
	if (typeof translated === 'string' && translated !== '') entry.vi = translated;
	if (Array.isArray(row.tags) && row.tags.length > 0) entry.tags = row.tags;
	merged.set(row.id, entry);
}

const quotes = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
const bilingual = quotes.filter((q) => q.vi !== undefined && q.en !== undefined);

const payload = {
	version: 1,
	source: 'QuoteAtlas data/quotes — CC0, public-domain and own-translation entries only',
	counts: {
		total: quotes.length,
		bilingual: bilingual.length,
		viOnly: quotes.filter((q) => q.en === undefined).length,
		enOnly: quotes.filter((q) => q.vi === undefined).length
	},
	quotes
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, '\t')}\n`, 'utf8');

console.log(`\nwrote ${OUT}`);
console.log(`  ${String(payload.counts.total)} entries`);
console.log(`  ${String(payload.counts.bilingual)} bilingual — the daily-pick pool`);
console.log(`  ${String(payload.counts.viOnly)} vi-only, ${String(payload.counts.enOnly)} en-only`);
console.log(`  ${String(Math.round(readFileSync(OUT).length / 1024))} KB raw`);
