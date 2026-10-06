import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { notesFor } from '../../scripts/release-notes.mjs';

/**
 * CHANGELOG.md, package.json and the release notes, held together (doc 21 §1).
 *
 * release.yml refuses a tag that does not name package.json's version, and
 * takes the release's body from that version's CHANGELOG section. This is the
 * same pair of facts, checked on every pull request instead of at tag time,
 * when the tag can no longer be moved.
 */

const ROOT = process.cwd();
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const version = (
	JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

describe('the changelog and the version', () => {
	it('opens with the section for the version package.json carries, dated', () => {
		const newest = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/m.exec(changelog);
		expect(newest?.[1]).toBe(version);
		expect(Number.isNaN(Date.parse(newest?.[2] ?? ''))).toBe(false);
	});

	it('links the version to its release', () => {
		expect(changelog).toContain(
			`[${version}]: https://github.com/poli0981/tilepier/releases/tag/v${version}`
		);
	});

	it("gives that version's notes something to say", () => {
		const notes = notesFor(changelog, version);
		// Any of Keep a Changelog's kinds of change. This asked for `### Added`
		// until 1.0.1, a patch with nothing to add.
		expect(notes).toMatch(/^### (Added|Changed|Deprecated|Removed|Fixed|Security)$/m);
		expect(notes).not.toContain('## [');
	});
});

describe('notesFor', () => {
	const sample = [
		'# Changelog',
		'',
		'## [2.0.0] - 2027-01-02',
		'',
		'### Added',
		'- two',
		'',
		'## [1.0.0] - 2026-10-07',
		'',
		'- one',
		'',
		'[2.0.0]: https://example.com/2',
		'[1.0.0]: https://example.com/1',
		''
	].join('\n');

	it('takes one section, without its neighbours or the link references', () => {
		expect(notesFor(sample, '2.0.0')).toBe('### Added\n- two');
		expect(notesFor(sample, '1.0.0')).toBe('- one');
	});

	it('refuses a version the changelog does not have', () => {
		expect(() => notesFor(sample, '3.0.0')).toThrow('no section for 3.0.0');
	});
});
