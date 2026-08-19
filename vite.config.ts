import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Adapter, CSP, and compilerOptions live in svelte.config.js (doc 03 §Repo
// structure) so there is one place to look for framework configuration.
//
// No PWA plugin: the service worker is `src/service-worker.ts`, which SvelteKit
// compiles directly. Spike S5 explains why the plugin route was abandoned —
// see the header of that file and doc 22 §S5.

/**
 * `TP_BUILD` from doc 03 §Environment: version + short SHA, injected at build
 * time. The log ring buffer's boot line and the bug-report environment block
 * (doc 18 §1–2) both cite it, so a report can be pinned to a build.
 *
 * Three sources in order, because all three situations are real: Cloudflare
 * Workers Builds sets the env var and ships no `.git`; a local checkout has
 * git; a source tarball has neither.
 */
function buildInfo(): { version: string; sha: string } {
	const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
		version?: unknown;
	};
	const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';

	const fromCi = process.env['WORKERS_CI_COMMIT_SHA'] ?? process.env['CF_PAGES_COMMIT_SHA'];
	if (typeof fromCi === 'string' && fromCi.length > 0) {
		return { version, sha: fromCi.slice(0, 7) };
	}

	try {
		const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		if (sha.length > 0) return { version, sha };
	} catch {
		// No git, or not a repository. Fall through.
	}

	return { version, sha: 'dev' };
}

export default defineConfig({
	plugins: [
		// Before sveltekit(): the compiled output has to exist when SvelteKit
		// resolves $lib/paraglide imports.
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			// doc 14 §1. `url` is ruled out by that section; the built-in
			// `localStorage` strategy would create a fourth localStorage key, which
			// doc 05 §2 forbids — hence the custom one backed by the settings store.
			strategy: ['custom-tpsettings', 'preferredLanguage', 'baseLocale'],
			// Lets svelte-check read declarations instead of type-checking generated
			// JS under checkJs — which is what keeps `pnpm lint` clean given that the
			// output is gitignored and only exists after a compile.
			emitTsDeclarations: true
		}),
		tailwindcss(),
		sveltekit()
	],
	define: {
		__TP_BUILD__: JSON.stringify(buildInfo())
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					// Storage and <html> leak between component tests otherwise.
					setupFiles: ['./src/vitest-browser-setup.ts'],
					// doc 19 §1: component tests must carry the `.svelte.` infix or
					// they run in node and fail on DOM access.
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
