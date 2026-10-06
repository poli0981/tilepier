import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * axe-core against the page as it stands (doc 19 §1, doc 13 §8).
 *
 * WCAG 2.0, 2.1 and 2.2 at A and AA — the level the charter commits to (doc 01
 * §3). The Turnstile frame is excluded: it is Cloudflare's document, which the
 * suite's host rules keep from loading anyway (`_lib/launch.ts`).
 *
 * Returns one readable line per failing node rather than axe's result object,
 * so an assertion of `toEqual([])` prints exactly what is wrong and where.
 * An empty list is the only pass: an "incomplete" result (axe could not
 * decide) is not a violation and is not reported here.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

export async function axeViolations(page: Page, include?: string): Promise<string[]> {
	let builder = new AxeBuilder({ page })
		.withTags(TAGS)
		.exclude('iframe[src*="challenges.cloudflare.com"]');
	if (include !== undefined) builder = builder.include(include);

	const { violations } = await builder.analyze();
	return violations.flatMap((violation) =>
		violation.nodes.map(
			(node) =>
				`${violation.impact ?? 'unrated'} · ${violation.id} · ${violation.help} · ${node.target.join(' ')}${
					node.failureSummary === undefined ? '' : ` — ${node.failureSummary.replace(/\s+/g, ' ')}`
				}`
		)
	);
}
