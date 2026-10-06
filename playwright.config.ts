import { defineConfig } from '@playwright/test';
import { LAUNCH_ARGS } from './e2e/_lib/launch';

const PORT = 4173;
const BASE_URL = `https://localhost:${PORT}`;

/**
 * A run pointed at a deployed Worker — `e2e/s3-quota.e2e.ts`, doc 22 §S3 —
 * builds nothing and starts no `wrangler dev`: its load test and its keyed
 * test talk to that origin through `playwright.request`, and its four checks
 * of the local worker skip. Until 2026-09-25 the run did both: the keyed run
 * took a cold build first, and failed outright in a shell without `pnpm` on
 * its PATH, because the web server command calls it.
 *
 * (The first version of this said the file never touched the local server.
 * Four of its tests do, and they failed on a refused connection the first time
 * the whole file ran with `S3_BASE_URL` set — which is why they now skip.)
 *
 * Every other spec needs the local server, so this variable is for that file
 * alone.
 */
const DEPLOYED = process.env.S3_BASE_URL;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	// The suite is a per-PR gate budgeted under three minutes (doc 19 §4).
	timeout: 30_000,
	expect: { timeout: 5_000 },
	use: {
		baseURL: BASE_URL,
		// Pinned so the prerendered bilingual surfaces (doc 14 §6) resolve
		// deterministically: static/boot.js derives <html lang> from
		// navigator.language, and the runner's default would otherwise decide
		// which half of the gate is visible. Tests that care about `en` open
		// their own context or use the ?lang= switch.
		locale: 'vi-VN',
		// wrangler's local https cert is self-signed.
		ignoreHTTPSErrors: true,
		// The certificate flag and the hermetic host rules, explained where they
		// live. A spec that sets its own `launchOptions` must restate them.
		launchOptions: { args: LAUNCH_ARGS }
	},
	webServer: DEPLOYED
		? undefined
		: {
				// `wrangler dev` against the built worker, so the suite exercises the
				// real Cloudflare runtime: the _headers rules and the prerendered gate
				// both need that to mean anything.
				//
				// HTTPS locally is not optional. The CSP SvelteKit emits from
				// svelte.config.js ends with `upgrade-insecure-requests`, which over
				// plain HTTP rewrites every subresource request to https on a port that
				// is not listening — the app never hydrates, and only the tests that
				// need JavaScript fail, which is a genuinely confusing way to find out.
				command: `pnpm build && pnpm exec wrangler dev .svelte-kit/cloudflare/_worker.js --port ${PORT} --local-protocol https`,
				url: BASE_URL,
				ignoreHTTPSErrors: true,
				reuseExistingServer: !process.env.CI,
				// Cold build plus workerd start-up.
				timeout: 180_000,
				stdout: 'pipe',
				stderr: 'pipe'
			}
});
