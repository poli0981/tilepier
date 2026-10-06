// Prints CHANGELOG.md's section for one version — the body of its GitHub
// Release (doc 21 §1). release.yml runs it; `release.test.ts` holds it, and
// holds the newest section to package.json's version.
//
//   node scripts/release-notes.mjs 1.0.0

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The text under `## [<version>]`, up to the next version's heading or the
 * link references at the foot of the file.
 *
 * @param {string} changelog
 * @param {string} version
 * @returns {string}
 */
export function notesFor(changelog, version) {
	const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
	const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
	if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}`);
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => line.startsWith('## [') || /^\[[^\]]+\]: /.test(line));
	return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const version = process.argv[2];
	if (version === undefined || version === '') {
		console.error('usage: node scripts/release-notes.mjs <version>');
		process.exit(2);
	}
	process.stdout.write(`${notesFor(readFileSync('CHANGELOG.md', 'utf8'), version)}\n`);
}
