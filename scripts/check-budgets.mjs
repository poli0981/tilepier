/**
 * Bundle budget gate, doc 20 §6. Run after `pnpm build`.
 *
 * Reads the built Cloudflare asset directory, gzips each file to get the size
 * a browser actually pays, and compares against scripts/budgets.json.
 *
 * Design notes:
 *  - Budgets marked `optional` do not fail when nothing matches. Most chunks
 *    they describe (echarts, maplibre, widget tiles, detail views) do not exist
 *    yet; the rows are here so the gate starts enforcing them the moment the
 *    code lands, rather than being remembered later. Every skipped row is
 *    printed — silent absence would read as "passing".
 *  - Non-optional rows fail if they match nothing, so a renamed entry chunk
 *    cannot quietly disable its own budget.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetDir = join(root, '.svelte-kit', 'cloudflare');
const config = JSON.parse(readFileSync(join(root, 'scripts', 'budgets.json'), 'utf8'));

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

let files;
try {
	files = walk(assetDir).map((full) => {
		const raw = readFileSync(full);
		return {
			path: relative(assetDir, full).split(sep).join('/'),
			rawBytes: raw.length,
			gzipBytes: gzipSync(raw, { level: 9 }).length
		};
	});
} catch {
	console.error(`No build output at ${relative(root, assetDir)} — run \`pnpm build\` first.`);
	process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

/** Selects the files a budget row applies to. */
function select(budget) {
	switch (budget.kind) {
		case 'entry-js':
			// SvelteKit names the browser entry `_app/immutable/entry/start.*` and
			// `app.*`; both load on first paint, so they count together.
			return files.filter((f) => /^_app\/immutable\/entry\/.*\.js$/.test(f.path));
		case 'css-total':
			return files.filter((f) => f.path.endsWith('.css'));
		case 'static-glob': {
			const re = new RegExp('^' + budget.glob.replace(/\*/g, '[^/]*') + '$');
			return files.filter((f) => re.test(f.path));
		}
		case 'chunk-match':
		case 'chunk-glob':
			return files.filter((f) => f.path.includes(budget.match) && f.path.endsWith('.js'));
		default:
			throw new Error(`unknown budget kind: ${budget.kind}`);
	}
}

/** Rows that cap a total sum rather than each file individually. */
const SUMMED = new Set(['entry-js', 'css-total', 'static-glob']);

let failed = 0;
let skipped = 0;

console.log(`\nBundle budgets (doc 20 §6) — ${files.length} built files\n`);

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
		console.log(`  FAIL  ${budget.label}\n        matched no files; expected at least one`);
		continue;
	}

	if (SUMMED.has(budget.kind)) {
		const total = matched.reduce((sum, f) => sum + sizeOf(f), 0);
		const ok = total <= limit;
		if (!ok) failed += 1;
		console.log(
			`  ${ok ? 'PASS' : 'FAIL'}  ${budget.label}\n` +
				`        ${kb(total)} ${unit} of ${kb(limit)} across ${matched.length} file(s)`
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
			`        largest ${kb(sizeOf(worst))} ${unit} of ${kb(limit)} (${worst.path})`
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
