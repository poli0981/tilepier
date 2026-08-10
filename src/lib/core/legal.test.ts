import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGAL_VERSION } from '$lib/shared-constants';

/**
 * static/boot.js runs before the bundle exists, so it cannot import
 * LEGAL_VERSION — it hardcodes the number. That duplication is only safe if
 * something notices when the two drift, which is what this does.
 *
 * Drift here is not cosmetic: bumping LEGAL_VERSION to re-gate users after a
 * material change to the terms would silently do nothing, because boot.js
 * would keep setting data-legal="ok" against the old number.
 */
describe('static/boot.js', () => {
	const source = readFileSync(join(process.cwd(), 'static', 'boot.js'), 'utf8');

	it('hardcodes the same LEGAL_VERSION as shared-constants', () => {
		const match = /var LEGAL_VERSION = (\d+);/.exec(source);
		expect(match, 'LEGAL_VERSION declaration not found in boot.js').not.toBeNull();
		expect(Number(match?.[1])).toBe(LEGAL_VERSION);
	});

	it('reads the localStorage key doc 05 §2 declares', () => {
		expect(source).toContain("'tp.legal.v1'");
		expect(source).toContain("'tp.settings.v1'");
	});

	it('contains no inline-blocked constructs and stays small', () => {
		// CSP is script-src 'self' with no unsafe-eval (doc 15 §2).
		expect(source).not.toMatch(/\beval\s*\(/);
		expect(source).not.toMatch(/new\s+Function\s*\(/);
		// It blocks first paint, so it must stay trivial.
		expect(source.length).toBeLessThan(4096);
	});
});
