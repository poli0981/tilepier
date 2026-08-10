/**
 * Bundle budget gate, doc 20 §6. Run after `pnpm build`.
 *
 * Reads the client build manifest and gzips the emitted files to get the size
 * a browser actually pays.
 *
 * Chunks are matched by the **source module** that produced them, taken from
 * the manifest, rather than by filename. SvelteKit owns the emitted names and
 * they are content hashes: a filename-matching budget stops measuring the
 * moment a hash changes, and does so silently — which is worse than having no
 * budget, because the report still says PASS. (An earlier version of this
 * script matched names and reported four rows as "no matching chunk" while the
 * chunks were sitting right there.)
 *
 * Budgets marked `optional` do not fail when nothing matches — most describe
 * widget chunks that do not exist yet. Every skipped row is printed, because
 * silent absence reads as success.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = join(root, '.svelte-kit', 'cloudflare');
const manifestPath = join(root, '.svelte-kit', 'output', 'client', '.vite', 'manifest.json');
const config = JSON.parse(readFileSync(join(root, 'scripts', 'budgets.json'), 'utf8'));

if (!existsSync(assetDir) || !existsSync(manifestPath)) {
	console.error(`No build output found — run \`pnpm build\` first.`);
	process.exit(1);
}

/** @type {Record<string, { file: string, isEntry?: boolean, isDynamicEntry?: boolean }>} */
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

const files = new Map(
	walk(assetDir).map((full) => {
		const raw = readFileSync(full);
		const path = relative(assetDir, full).split(sep).join('/');
		return [path, { path, rawBytes: raw.length, gzipBytes: gzipSync(raw, { level: 9 }).length }];
	})
);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** Manifest keys whose emitted file exists, matched against a regex. */
function modulesMatching(pattern) {
	const re = new RegExp(pattern);
	const out = [];
	for (const [source, entry] of Object.entries(manifest)) {
		if (!re.test(source)) continue;
		const file = files.get(entry.file);
		if (file) out.push({ source, ...file });
	}
	return out;
}

function select(budget) {
	switch (budget.kind) {
		case 'entry-js':
			// Everything the browser loads before it can render anything.
			return [...files.values()].filter((f) => /^_app\/immutable\/entry\/.*\.js$/.test(f.path));
		case 'css-total':
			return [...files.values()].filter((f) => f.path.endsWith('.css'));
		case 'static-glob': {
			const re = new RegExp('^' + budget.glob.replace(/\*/g, '[^/]*') + '$');
			return [...files.values()].filter((f) => re.test(f.path));
		}
		case 'module':
		case 'module-each':
			return modulesMatching(budget.module);
		default:
			throw new Error(`unknown budget kind: ${budget.kind}`);
	}
}

/** Rows that cap a total sum rather than each file individually. */
const SUMMED = new Set(['entry-js', 'css-total', 'static-glob', 'module']);

let failed = 0;
let skipped = 0;

console.log(`\nBundle budgets (doc 20 §6) — ${files.size} built files\n`);

for (const budget of config.budgets) {
	const matched = select(budget);
	const useRaw = typeof budget.maxRawBytes === 'number';
	const limit = useRaw ? budget.maxRawBytes : budget.maxGzipBytes;
	const sizeOf = (f) => (useRaw ? f.rawBytes : f.gzipBytes);
	const unit = useRaw ? 'raw' : 'gz';

	if (matched.length === 0) {
		if (budget.optional) {
			skipped += 1;
			console.log(`  SKIP  ${budget.label}\n        no matching chunk yet — budget not enforced`);
			continue;
		}
		failed += 1;
		console.log(
			`  FAIL  ${budget.label}\n        matched no files; expected at least one. ` +
				`If the module moved, update its matcher in scripts/budgets.json.`
		);
		continue;
	}

	if (SUMMED.has(budget.kind)) {
		const total = matched.reduce((sum, f) => sum + sizeOf(f), 0);
		const ok = total <= limit;
		if (!ok) failed += 1;
		const pct = Math.round((total / limit) * 100);
		console.log(
			`  ${ok ? 'PASS' : 'FAIL'}  ${budget.label}\n` +
				`        ${kb(total)} ${unit} of ${kb(limit)} (${pct}%) across ${matched.length} file(s)`
		);
		if (!ok) for (const f of matched) console.log(`          ${kb(sizeOf(f))}  ${f.path}`);
		continue;
	}

	// Per-file rows: the largest single chunk decides.
	const worst = matched.reduce((a, b) => (sizeOf(a) >= sizeOf(b) ? a : b));
	const ok = sizeOf(worst) <= limit;
	if (!ok) failed += 1;
	console.log(
		`  ${ok ? 'PASS' : 'FAIL'}  ${budget.label}\n` +
			`        largest ${kb(sizeOf(worst))} ${unit} of ${kb(limit)} ` +
			`across ${matched.length} chunk(s) — ${worst.source}`
	);
}

if (skipped) {
	console.log(`\n  ${skipped} budget(s) not yet enforced — the chunks they cover do not exist.`);
}

if (failed) {
	console.error(`\n${failed} budget(s) over limit.\n`);
	process.exit(1);
}

console.log('\nAll enforced budgets within limits.\n');
