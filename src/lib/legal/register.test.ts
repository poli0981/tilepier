import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGISTER } from './register';

/**
 * doc 16 §5's register against the one the page renders, row for row.
 *
 * Until Week 8 the page kept its own list and nothing compared the two; it had
 * fallen two rows behind the doc (the quote dataset, qrcode-generator) and
 * named no icon source.
 */

/** The "Item" cells of doc 16 §5's table. */
function documentedItems(): string[] {
	const md = readFileSync(join(process.cwd(), 'docs', 'internal', '16-LEGAL-PRIVACY.md'), 'utf8');
	const section = md.split('## 5. Third-party attribution register')[1]?.split('\n## ')[0] ?? '';
	return section
		.split('\n')
		.filter((line) => line.startsWith('| ') && !line.startsWith('| Item '))
		.map((line) => line.split('|')[1]?.trim() ?? '');
}

describe('the licences register (doc 16 §5)', () => {
	it('has a row for every source the doc lists, and none it does not', () => {
		const documented = documentedItems();
		expect(documented.length, 'doc 16 §5 table not found').toBeGreaterThan(10);
		expect(REGISTER.map((row) => row.doc).sort()).toEqual([...documented].sort());
	});

	it('links over https only', () => {
		for (const row of REGISTER) {
			for (const href of [row.href, row.licenceHref]) {
				if (href !== undefined) expect(href, row.item).toMatch(/^https:\/\//);
			}
		}
	});
});
