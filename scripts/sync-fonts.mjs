/**
 * Copies the exact font subsets TilePier ships from the @fontsource dev
 * dependencies into static/fonts/, and fails if the result blows the doc 20 §6
 * budget.
 *
 * Why a script instead of importing the fontsource CSS directly: those
 * stylesheets also reference .woff files, which every browser in the doc 02 §6
 * support matrix ignores in favour of .woff2. Copying explicitly keeps the
 * shipped set to exactly what is served — vietnamese + latin, woff2 only
 * (doc 12 §3) — and keeps the @font-face rules in src/app.css, where the
 * unicode-range split is visible next to the tokens.
 *
 * Run after bumping either @fontsource package. Diff static/fonts/ afterwards.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'static', 'fonts');

/** Budget for the total shipped font payload, doc 20 §6. */
const BUDGET_BYTES = 220 * 1024;

const FAMILIES = [
	{ pkg: '@fontsource/be-vietnam-pro', file: 'be-vietnam-pro', weights: [400, 500, 600] },
	{ pkg: '@fontsource/jetbrains-mono', file: 'jetbrains-mono', weights: [400, 600] }
];
const SUBSETS = ['latin', 'vietnamese'];

mkdirSync(dest, { recursive: true });

let total = 0;
const copied = [];

for (const { pkg, file, weights } of FAMILIES) {
	const pkgDir = join(root, 'node_modules', pkg);

	// Ship the upstream OFL text alongside the fonts (doc 16 §5).
	const licenceTarget = `${file
		.split('-')
		.map((s) => s[0].toUpperCase() + s.slice(1))
		.join('')}-OFL.txt`;
	writeFileSync(join(dest, licenceTarget), readFileSync(join(pkgDir, 'LICENSE')));

	for (const subset of SUBSETS) {
		for (const weight of weights) {
			const name = `${file}-${subset}-${weight}-normal.woff2`;
			const src = join(pkgDir, 'files', name);
			const bytes = readFileSync(src);
			writeFileSync(join(dest, name), bytes);
			total += bytes.length;
			copied.push(name);
		}
	}
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const name of copied) {
	console.log(`  ${kb(statSync(join(dest, basename(name))).size).padStart(9)}  ${name}`);
}
console.log(`\n  total ${kb(total)} of ${kb(BUDGET_BYTES)} budget (doc 20 §6)`);

if (total > BUDGET_BYTES) {
	console.error(`\nFont payload is over budget by ${kb(total - BUDGET_BYTES)}.`);
	process.exit(1);
}
