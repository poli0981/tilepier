import { expect, test } from '@playwright/test';
import { SECURITY_HEADERS } from '../src/lib/server/security-headers';

/**
 * What production sends, held to the same list as the local suite (doc 15 §2).
 *
 * `legal-gate.e2e.ts` can only reach `wrangler dev`, and production is not
 * identical: the zone replaces HSTS at the edge and adds `Nel` and `Report-To`,
 * and a zone setting can add or rewrite more. So the owner runs this after a
 * deploy (doc 19 §5):
 *
 *     S3_BASE_URL=https://tilepier.win pnpm exec playwright test e2e/prod-headers.e2e.ts
 *
 * With `S3_BASE_URL` set, `playwright.config.ts` builds nothing and starts no
 * local server. Without it this skips, as the deployed S3 checks do. Headers
 * the edge adds are not this test's business; one it drops or rewrites is.
 */

const DEPLOYED = process.env.S3_BASE_URL;

test.describe('production', () => {
	test.skip(!DEPLOYED, 'set S3_BASE_URL to the deployed origin — see the note above');
	test.use({ baseURL: DEPLOYED });

	test('sends every security header on prerendered pages and on a rendered 404', async ({
		request
	}) => {
		for (const path of ['/', '/legal/privacy', '/no-such-page']) {
			const response = await request.get(path);
			const headers = response.headers();

			for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
				expect(headers[name], `${path}: ${name}`).toBe(value);
			}
			expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
			// doc 16 §3: the only cookie on the site is cf_clearance, after a passed
			// bot check — never on a page.
			expect(headers['set-cookie'], path).toBeUndefined();
		}
	});
});
