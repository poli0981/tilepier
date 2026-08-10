import { defineConfig } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `https://localhost:${PORT}`;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}',
	// The suite is a per-PR gate budgeted under three minutes (doc 19 §4).
	timeout: 30_000,
	expect: { timeout: 5_000 },
	use: {
		baseURL: BASE_URL,
		// wrangler's local https cert is self-signed.
		ignoreHTTPSErrors: true,
		launchOptions: {
			// `ignoreHTTPSErrors` covers page and API requests but NOT the fetch
			// of a service worker script: Chromium enforces certificate validity
			// there regardless, and registration fails with "An SSL certificate
			// error occurred when fetching the script" — silently, since nothing
			// rejects. The browser flag is the only way to test a service worker
			// against wrangler's self-signed local cert. Local test rig only;
			// production serves a real certificate.
			args: ['--ignore-certificate-errors']
		}
	},
	webServer: {
		// `wrangler dev` against the built worker, so the suite exercises the real
		// Cloudflare runtime: the _headers rules and the prerendered gate both
		// need that to mean anything.
		//
		// HTTPS locally is not optional. The CSP in _headers ends with
		// `upgrade-insecure-requests`, which over plain HTTP rewrites every
		// subresource request to https on a port that is not listening — the app
		// never hydrates, and only the tests that need JavaScript fail, which is
		// a genuinely confusing way to find out.
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
