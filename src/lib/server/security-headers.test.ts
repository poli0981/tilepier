import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from './security-headers';

/**
 * One list (doc 15 §2), and the copies a reader trusts held to it: the root
 * `_headers` file, which is what every prerendered page is served with, and
 * doc 15 §2's block. Until Week 8 `_headers` and the hook agreed by hand —
 * "change both together" — and the e2e suite checked four of the five values
 * exactly and Permissions-Policy only for a substring.
 */

const ROOT = process.cwd();

function read(...path: string[]): string {
	return readFileSync(join(ROOT, ...path), 'utf8');
}

/** `_headers`' rules for one path pattern, as lower-cased name → value. */
function rules(pattern: string): Record<string, string> {
	const lines = read('_headers').split(/\r?\n/);
	const start = lines.indexOf(pattern);
	expect(start, `_headers has no ${pattern} block`).toBeGreaterThan(-1);

	const block: Record<string, string> = {};
	for (const line of lines.slice(start + 1)) {
		if (!/^\s+\S/.test(line)) break;
		const colon = line.indexOf(':');
		const name = line.slice(0, colon).trim().toLowerCase();
		expect(block[name], `_headers names ${name} twice`).toBeUndefined();
		block[name] = line.slice(colon + 1).trim();
	}
	return block;
}

/** The single-line headers in doc 15 §2's block; the CSP spans lines, and is
 *  SvelteKit's to emit. */
function documented(): Record<string, string> {
	const section = read('docs', 'internal', '15-SECURITY.md').split('\n## 2.')[1] ?? '';
	const block = section.split('```')[1] ?? '';
	const headers: Record<string, string> = {};
	for (const line of block.split('\n')) {
		const header = /^([A-Za-z-]+): (\S.*)$/.exec(line);
		if (header?.[1] !== undefined && header[2] !== undefined) {
			headers[header[1].toLowerCase()] = header[2];
		}
	}
	return headers;
}

/** `frame-ancestors` as svelte.config.js configures it for SvelteKit's policy. */
function configuredAncestors(): string {
	const sources = /'frame-ancestors':\s*\[([^\]]*)\]/.exec(read('svelte.config.js'))?.[1];
	expect(sources, 'svelte.config.js configures no frame-ancestors').toBeDefined();
	return [...(sources ?? '').matchAll(/'([^']+)'/g)].map(([, source]) => `'${source}'`).join(' ');
}

describe('security headers (doc 15 §2)', () => {
	it('are what _headers serves prerendered pages, with only the frame-ancestors a <meta> policy drops', () => {
		expect(rules('/*')).toEqual({
			...SECURITY_HEADERS,
			'content-security-policy': `frame-ancestors ${configuredAncestors()}`
		});
	});

	it('are the ones doc 15 §2 states', () => {
		expect(documented()).toEqual(SECURITY_HEADERS);
	});
});
