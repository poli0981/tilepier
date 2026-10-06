import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `static/.well-known/security.txt` against RFC 9116, and against the calendar
 * (doc 15 §8).
 *
 * The RFC's one moving part is `Expires`: past it, a reader is to treat the
 * file as stale, so a security.txt nobody renews quietly stops being a contact.
 * This goes red thirty days before that happens. Renew it then, to less than a
 * year ahead, as the RFC asks.
 */

const ROOT = process.cwd();
const DAY = 86_400_000;

/** The fields RFC 9116 §2.5 defines. */
const DEFINED = new Set([
	'Acknowledgments',
	'Canonical',
	'Contact',
	'Encryption',
	'Expires',
	'Hiring',
	'Policy',
	'Preferred-Languages'
]);

const lines = readFileSync(join(ROOT, 'static', '.well-known', 'security.txt'), 'utf8')
	.split('\n')
	.filter((line) => line !== '' && !line.startsWith('#'));

function values(name: string): string[] {
	return lines
		.filter((line) => line.startsWith(`${name}: `))
		.map((line) => line.slice(name.length + 2));
}

describe('security.txt (RFC 9116, doc 15 §8)', () => {
	it('is fields the RFC defines and comments, nothing else', () => {
		for (const line of lines) {
			expect(DEFINED.has(line.split(': ')[0] ?? ''), line).toBe(true);
		}
	});

	it('names the repository advisory form as its contact', () => {
		expect(values('Contact')).toEqual([
			'https://github.com/poli0981/tilepier/security/advisories/new'
		]);
	});

	it('expires once, in the RFC date format, within the year and not within thirty days', () => {
		const expires = values('Expires');
		expect(expires).toHaveLength(1);
		expect(expires[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

		const left = Date.parse(expires[0] ?? '') - Date.now();
		expect(left, 'security.txt expires within thirty days: renew Expires').toBeGreaterThan(
			30 * DAY
		);
		expect(left, 'RFC 9116 asks for less than a year ahead').toBeLessThan(366 * DAY);
	});

	it('is canonical where it is served, and points at a policy that exists', () => {
		expect(values('Canonical')).toEqual(['https://tilepier.win/.well-known/security.txt']);
		expect(values('Policy')).toEqual(['https://github.com/poli0981/tilepier/security/policy']);
		// GitHub's policy page is the repository's SECURITY.md.
		expect(existsSync(join(ROOT, 'SECURITY.md'))).toBe(true);
	});
});
