import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ACCESSIBILITY.md against the repository it describes (doc 13 §8, doc 19 §4).
 *
 * A statement is a promise in a doc, and in this codebase a promise is not a
 * gate until something goes red without it. This holds the parts that can
 * drift by themselves: the level it names against the level the axe sweep
 * runs, the review against the version that ships, and every way in to it —
 * the form it sends readers to, the READMEs, CONTRIBUTING and the app's own
 * About page.
 */

const ROOT = process.cwd();

function read(...path: string[]): string {
	return readFileSync(join(ROOT, ...path), 'utf8');
}

const statement = read('ACCESSIBILITY.md');

describe('ACCESSIBILITY.md', () => {
	it('names the level the axe sweep tests, and the sweep tests it', () => {
		expect(statement).toContain('WCAG 2.2');
		expect(statement).toContain('**Level AA**');

		const axe = read('e2e', '_lib', 'axe.ts');
		const tags = /const TAGS = \[([^\]]*)\]/.exec(axe)?.[1] ?? '';
		for (const tag of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
			expect(tags).toContain(`'${tag}'`);
	});

	it('was reviewed for the minor version that ships', () => {
		// The statement is reviewed before each minor release (its own
		// Ownership section). A patch keeps the review; a minor needs a new one.
		const reviewed =
			/Reviewed for version \*\*(\d+)\.(\d+)\.\d+\*\* on \*\*\d{4}-\d{2}-\d{2}\*\*/.exec(statement);
		const version = (JSON.parse(read('package.json')) as { version: string }).version;
		const [major, minor] = version.split('.');

		expect(reviewed).not.toBeNull();
		expect(`${reviewed?.[1]}.${reviewed?.[2]}`).toBe(`${major}.${minor}`);
	});

	it('sends readers to an issue form that exists and is labelled for triage', () => {
		const form = /issues\/new\?template=([\w.-]+\.yml)/.exec(statement)?.[1];
		expect(form).toBe('accessibility.yml');

		const path = join(ROOT, '.github', 'ISSUE_TEMPLATE', form ?? '');
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, 'utf8')).toMatch(/^labels: \[accessibility\]$/m);
	});

	it('is linked from both READMEs, CONTRIBUTING and the About page', () => {
		for (const file of ['README.md', 'README.vi.md', 'CONTRIBUTING.md'])
			expect(read(file), file).toContain('(ACCESSIBILITY.md)');

		const about = read('src', 'routes', 'about', '+page.svelte');
		expect(about).toContain('/blob/main/ACCESSIBILITY.md');
		expect(about).toContain('/issues/new?template=accessibility.yml');
	});

	it('links only files that are there', () => {
		for (const [, target] of statement.matchAll(/\]\((?!https?:|#)([^)]+)\)/g))
			expect(existsSync(join(ROOT, target ?? '')), target).toBe(true);
	});
});
