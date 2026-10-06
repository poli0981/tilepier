import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import generated from './licenses.generated.json';

/**
 * The committed licence appendix (doc 16 §5), read without a build.
 *
 * `pnpm licenses:gen --check` in CI is what holds this file to the build; this
 * holds it to what is known without one — every runtime dependency, and the
 * devDependencies that ship anyway, which are the reason the generator reads
 * the module graph rather than `pnpm licenses list --prod` alone.
 */

interface TpEntry {
	name: string;
	license: string;
	homepage: string;
	source?: string;
}

const licences: { packages: TpEntry[]; text: string }[] = generated.licences;
const entries = licences.flatMap((group) => group.packages);
const names = new Set(entries.map((entry) => entry.name));

describe('licenses.generated.json (doc 16 §5)', () => {
	it('lists every runtime dependency', () => {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
			dependencies: Record<string, string>;
		};
		for (const name of Object.keys(pkg.dependencies)) expect(names, name).toContain(name);
	});

	it('lists what ships from devDependencies, which `--prod` cannot see', () => {
		for (const name of [
			'svelte',
			'@sveltejs/kit',
			'devalue',
			'cookie',
			'set-cookie-parser',
			'@sveltejs/adapter-cloudflare',
			'worktop',
			'@inlang/paraglide-js',
			'tailwindcss',
			'@fontsource/be-vietnam-pro',
			'@fontsource/jetbrains-mono',
			'Lucide (icon geometry)'
		]) {
			expect(names, name).toContain(name);
		}
	});

	it('gives every entry a licence, a text and a page, and no version', () => {
		for (const { packages, text } of licences) {
			expect(text.length, packages[0]?.name).toBeGreaterThan(100);
			for (const entry of packages) {
				expect(entry.license, entry.name).not.toBe('');
				// As the package publishes it: rewriting http to https can break a link.
				expect(entry.homepage, entry.name).toMatch(/^https?:\/\//);
				expect(entry.name, 'a name, not name@version').not.toMatch(/.@\d/);
			}
		}
	});

	it('keeps each text once, and types out of it', () => {
		const texts = licences.map((group) => group.text);
		expect(new Set(texts).size).toBe(texts.length);
		expect([...names].filter((name) => name.startsWith('@types/'))).toEqual([]);
	});

	it('marks each text that is not a licence file with where it came from', () => {
		for (const entry of entries) {
			if (entry.source !== undefined) {
				expect(['readme', 'header', 'declared'], entry.name).toContain(entry.source);
			}
		}
		// qrcode-generator ships no licence file; its notice — with the DENSO WAVE
		// trademark line doc 16 §5 asks the page to carry — opens its source.
		const qr = licences.find((group) => group.packages.some((p) => p.name === 'qrcode-generator'));
		expect(qr?.text).toContain('DENSO WAVE');
	});
});
