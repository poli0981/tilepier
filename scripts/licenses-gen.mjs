// Generates the dependency licence appendix of /legal/licenses (doc 16 §5).
//
//   pnpm build && pnpm licenses:gen    writes src/lib/legal/licenses.generated.json
//   pnpm licenses:gen --check          exits 1 when the committed file is stale
//
// What ships is the union of four answers, because no one of them is whole:
//
//  1. The build's own module graph — the page, the server and the music tag
//     worker — recorded by scripts/vite-shipped.ts. It is the only source that
//     sees svelte, SvelteKit, devalue, cookie and set-cookie-parser, which are
//     devDependencies (or under them) and ship anyway.
//  2. The adapter's _worker.js, bundled by esbuild, which names each module it
//     inlined in a path comment (worktop, for one).
//  3. `pnpm licenses list --prod`: everything wrangler bundles at deploy rather
//     than Vite at build, and MapLibre's dependencies, whose code is inside the
//     vendored MapLibre files rather than in any graph.
//  4. EXTRA and VENDORED below, for what ships without passing through a graph.
//
// Listing a package that turns out not to ship costs a paragraph; leaving out
// one that does is the breach. So the union errs wide. Versions are left out,
// so a patch release does not churn the file; identical texts are kept once.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'src/lib/legal/licenses.generated.json';
const SHIPPED_DIR = '.svelte-kit/tp-shipped';
const WORKER = '.svelte-kit/cloudflare/_worker.js';

/** Packages that ship without going through any graph the build can read. */
const EXTRA = [
	[
		'@inlang/paraglide-js',
		'its runtime is compiled into src/lib/paraglide and ships in every page'
	],
	['tailwindcss', 'its preflight opens every stylesheet'],
	['@sveltejs/adapter-cloudflare', 'its worker entry wraps the server in _worker.js'],
	['@fontsource/be-vietnam-pro', 'scripts/sync-fonts.mjs copies its font files into static/fonts'],
	['@fontsource/jetbrains-mono', 'scripts/sync-fonts.mjs copies its font files into static/fonts']
];

/** Licences that live in this repository, beside what they cover. */
const VENDORED = [
	{
		name: 'Lucide (icon geometry)',
		license: 'ISC AND MIT',
		homepage: 'https://lucide.dev',
		file: 'src/lib/ui/icons/LICENSE-lucide.txt'
	}
];

const MIT_PERMISSION = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

/** CRLF to LF, no trailing spaces, no blank lines at either end. */
function tidy(text) {
	return text
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.trimEnd())
		.join('\n')
		.trim();
}

/** Code-point order: the same on every machine, unlike localeCompare. */
function byName(a, b) {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** The package directory under node_modules for a module path, or null. */
function rootOf(path) {
	const normal = path.replace(/\\/g, '/');
	const pnpm = /node_modules\/(\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+)/.exec(normal);
	if (pnpm !== null) return join('node_modules', pnpm[1] ?? '');
	const flat = /node_modules\/((?:@[^/]+\/)?[^/.][^/]*)/.exec(normal);
	return flat === null ? null : join('node_modules', flat[1] ?? '');
}

/** The licence id from package.json, in any of the shapes it has had. */
function licenseId(pkg) {
	if (typeof pkg.license === 'string') return pkg.license;
	if (typeof pkg.license?.type === 'string') return pkg.license.type;
	if (Array.isArray(pkg.licenses)) return pkg.licenses.map((entry) => entry.type).join(' OR ');
	return 'see text';
}

function author(pkg) {
	if (typeof pkg.author === 'string') return pkg.author.replace(/\s*[<(].*$/, '');
	return typeof pkg.author?.name === 'string' ? pkg.author.name : 'its authors';
}

/** Where a package lives: its homepage, else its repository as a web URL. */
function homepage(pkg) {
	if (typeof pkg.homepage === 'string') return pkg.homepage.replace(/#.*$/, '');
	const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
	if (typeof repository !== 'string') return `https://www.npmjs.com/package/${pkg.name}`;
	const url = repository
		.replace(/^git\+/, '')
		.replace(/^git:\/\//, 'https://')
		.replace(/^git@github\.com:/, 'https://github.com/')
		.replace(/^github:/, '')
		.replace(/\.git$/, '');
	// npm's shorthand, `owner/repo`, means GitHub.
	return /^[\w.-]+\/[\w.-]+$/.test(url) ? `https://github.com/${url}` : url;
}

/** The body under a README's "Licence" heading, up to the next heading. */
function readmeSection(markdown) {
	const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
	const start = lines.findIndex((line) => /^#{1,3} licen[cs]e\s*$/i.test(line));
	if (start === -1) return '';
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^#{1,3} /.test(line));
	return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** A source file's opening comment, if it is a copyright and licence notice. */
function headerNotice(source) {
	const head = /^\s*((?:\/\/[^\n]*\n)+|\/\*[\s\S]*?\*\/)/.exec(source)?.[1];
	if (head === undefined || !/copyright/i.test(head) || !/licen[cs]e/i.test(head)) return null;
	return tidy(
		head
			.split('\n')
			.map((line) => line.replace(/^\s*(\/\/|\/\*+|\*\/|\*)\s?/, '').replace(/^-{8,}$/, ''))
			.join('\n')
			.replace(/\*\/\s*$/, '')
	);
}

/**
 * A package's licence text, and where it came from when that is not a licence
 * file. In order: the files (NOTICE too: Apache-2.0 §4(d) asks for a NOTICE
 * file's notices); a README "Licence" section that carries the whole text; the
 * main file's opening notice, with the MIT text it names; and, for a package
 * that declares MIT and ships no text at all, the MIT text with its author as
 * the holder, which the page says. Anything else stops the run.
 */
function licenceOf(dir, pkg) {
	const files = readdirSync(dir)
		.filter((file) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file))
		.sort();
	if (files.length > 0) {
		return { text: files.map((file) => tidy(readFileSync(join(dir, file), 'utf8'))).join('\n\n') };
	}

	const readme = readdirSync(dir).find((file) => /^readme(\.md)?$/i.test(file));
	const section =
		readme === undefined ? '' : readmeSection(readFileSync(join(dir, readme), 'utf8'));
	if (/permission/i.test(section)) return { text: tidy(section), source: 'readme' };

	const main = typeof pkg.main === 'string' && pkg.main !== '' ? join(dir, pkg.main) : null;
	const notice =
		main !== null && existsSync(main) ? headerNotice(readFileSync(main, 'utf8')) : null;
	if (notice !== null) {
		const text = licenseId(pkg) === 'MIT' ? `${notice}\n\n${MIT_PERMISSION}` : notice;
		return { text, source: 'header' };
	}

	if (licenseId(pkg) === 'MIT') {
		return {
			text: `MIT License\n\nCopyright (c) ${author(pkg)}\n\n${MIT_PERMISSION}`,
			source: 'declared'
		};
	}
	throw new Error(
		`${pkg.name}: no licence text found, and it does not declare MIT — read it by hand`
	);
}

function shippedRoots() {
	if (!existsSync(SHIPPED_DIR) || !existsSync(WORKER)) {
		throw new Error('no build to read: run `pnpm build` first');
	}
	const roots = new Set();
	for (const file of readdirSync(SHIPPED_DIR).filter((name) => name.endsWith('.json'))) {
		for (const root of JSON.parse(readFileSync(join(SHIPPED_DIR, file), 'utf8'))) roots.add(root);
	}
	for (const line of readFileSync(WORKER, 'utf8').split('\n')) {
		const comment = /^\/\/ (\S*node_modules\/\S+)$/.exec(line.trim())?.[1];
		const root = comment === undefined ? null : rootOf(comment);
		if (root !== null) roots.add(root);
	}
	const prod = JSON.parse(execSync('pnpm licenses list --prod --json', { encoding: 'utf8' }));
	for (const group of Object.values(prod)) {
		for (const entry of group) {
			const path = entry.paths?.[0];
			if (typeof path === 'string') roots.add(path);
		}
	}
	for (const [name] of EXTRA) roots.add(join('node_modules', name));
	return roots;
}

function generate() {
	/** @type {Map<string, Map<string, object>>} text → package name → entry */
	const byText = new Map();
	const add = (entry, text) => {
		const packages = byText.get(text) ?? new Map();
		packages.set(entry.name, entry);
		byText.set(text, packages);
	};

	for (const root of shippedRoots()) {
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		if (pkg.name.startsWith('@types/')) continue;
		const { text, source } = licenceOf(root, pkg);
		add(
			{
				name: pkg.name,
				license: licenseId(pkg),
				homepage: homepage(pkg),
				...(source === undefined ? {} : { source })
			},
			text
		);
	}
	for (const vendored of VENDORED) {
		add(
			{ name: vendored.name, license: vendored.license, homepage: vendored.homepage },
			tidy(readFileSync(vendored.file, 'utf8'))
		);
	}

	const licences = [...byText.entries()]
		.map(([text, packages]) => ({ packages: [...packages.values()].sort(byName), text }))
		.sort((a, b) => byName(a.packages[0], b.packages[0]));
	const document = { generatedBy: 'pnpm licenses:gen (doc 16 §5). Do not edit by hand.', licences };
	return `${JSON.stringify(document, null, '\t')}\n`;
}

/** Every package name in a generated document. */
function names(json) {
	if (json === '') return new Set();
	return new Set(JSON.parse(json).licences.flatMap((group) => group.packages.map((p) => p.name)));
}

const output = generate();
if (process.argv.includes('--check')) {
	const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
	if (committed !== output) {
		const before = names(committed);
		const after = names(output);
		const added = [...after].filter((name) => !before.has(name));
		const removed = [...before].filter((name) => !after.has(name));
		console.error(`licenses:gen — ${OUT} is stale.`);
		if (added.length > 0) console.error(`  ships now, not listed: ${added.join(', ')}`);
		if (removed.length > 0) console.error(`  listed, no longer ships: ${removed.join(', ')}`);
		if (added.length === 0 && removed.length === 0) console.error('  a licence text changed');
		console.error('  Run `pnpm build && pnpm licenses:gen` and commit the result.');
		process.exit(1);
	}
	console.log(`licenses:gen — ${OUT} matches the build.`);
} else {
	writeFileSync(OUT, output);
	const groups = JSON.parse(output).licences;
	const packages = groups.flatMap((group) => group.packages);
	console.log(`licenses:gen — ${packages.length} entries, ${groups.length} texts → ${OUT}`);
	const declared = packages.filter((p) => p.source === 'declared').map((p) => p.name);
	if (declared.length > 0)
		console.log(`  no licence text shipped, MIT as declared: ${declared.join(', ')}`);
}
