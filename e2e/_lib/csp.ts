import type { Page } from '@playwright/test';

/**
 * Every Content-Security-Policy violation a test's pages report (doc 15 §2),
 * two ways at once:
 *
 * - the document's `securitypolicyviolation` events, collected by an init
 *   script from before the page's first script — the structured record,
 *   directive and blocked URL, that does not depend on console wording;
 * - the console's CSP errors, which also carry what a worker was refused.
 *
 * Call before the first navigation; read with the returned function. The
 * event half starts over with each document, so read it before a reload.
 */
export async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
	const logged: string[] = [];
	page.on('console', (message) => {
		if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
			logged.push(message.text());
		}
	});
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { __tpCsp: string[] }).__tpCsp = seen;
		document.addEventListener('securitypolicyviolation', (event) => {
			seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
		});
	});
	return async () => [
		...logged,
		...(await page.evaluate(() => (window as unknown as { __tpCsp?: string[] }).__tpCsp ?? []))
	];
}
