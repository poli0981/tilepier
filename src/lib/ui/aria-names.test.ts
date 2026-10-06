import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A name needs a role to belong to (WCAG 4.1.2; axe's aria-prohibited-attr).
 *
 * `aria-label` on a bare `<div>` or `<span>` names nothing: the element has no
 * role, and assistive technology drops the name. Week 8's sweep (`e2e/a11y`)
 * found eleven, nearly all loading skeletons — and found them only when a scan
 * happened to land while something was still loading, failing one full run in
 * several. This reads every component instead, so the rule holds whatever a
 * scan's timing.
 */

const ROOT = join(process.cwd(), 'src');

function components(directory: string): string[] {
	return readdirSync(directory).flatMap((entry) => {
		const path = join(directory, entry);
		if (statSync(path).isDirectory()) return entry === 'paraglide' ? [] : components(path);
		return path.endsWith('.svelte') ? [path] : [];
	});
}

/** Every `<div …>` and `<span …>` opening tag, however many lines it spans. */
const TAG = /<(div|span)\b([^>]*?)>/gs;

describe('aria-label has a role to belong to', () => {
	it('on every div and span in every component', () => {
		const offenders: string[] = [];
		for (const file of components(ROOT)) {
			const source = readFileSync(file, 'utf8');
			for (const match of source.matchAll(TAG)) {
				const attributes = match[2] ?? '';
				if (!/\baria-label\s*=/.test(attributes)) continue;
				if (/\brole\s*=/.test(attributes)) continue;
				const line = source.slice(0, match.index).split('\n').length;
				offenders.push(`${relative(process.cwd(), file)}:${line} <${match[1] ?? ''}>`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
