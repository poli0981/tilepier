import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * doc 20 §6's budget table against `scripts/budgets.json`, the source the
 * gate enforces (doc 20 §8: "tests assert docs' tables match").
 *
 * §8 had said so since Week 1, and nothing did: the doc's table and the JSON
 * agreed by hand, and one row had already drifted — the doc called the detail
 * row "Detail chunks w/ ECharts (weather, currency, markets)" while the gate
 * measured every detail chunk under another name (Week 8, doc 23). Rows are
 * matched by label, limits in KB (1024 bytes), gzip unless the JSON measures
 * raw bytes.
 */

interface TpBudget {
	id: string;
	label: string;
	maxGzipBytes?: number;
	maxRawBytes?: number;
}

const ROOT = process.cwd();
const budgets = (
	JSON.parse(readFileSync(join(ROOT, 'scripts', 'budgets.json'), 'utf8')) as {
		budgets: TpBudget[];
	}
).budgets;

/** label → limit in KB, from the table under "## 6. Bundle budgets". */
function docTable(): Map<string, number> {
	const md = readFileSync(join(ROOT, 'docs', 'internal', '20-CODE-QUALITY.md'), 'utf8');
	const section = md.split('## 6. Bundle budgets')[1]?.split('\n## ')[0] ?? '';
	const rows = new Map<string, number>();
	for (const line of section.split('\n')) {
		const cells = line.split('|').map((cell) => cell.trim());
		if (cells.length < 4) continue;
		const [, label, limit] = cells;
		const kb = /≤\s*([\d.]+)\s*KB/.exec(limit ?? '');
		if (label === undefined || kb === null) continue;
		rows.set(label, Number(kb[1]));
	}
	return rows;
}

describe('doc 20 §6 and scripts/budgets.json', () => {
	const table = docTable();

	it('reads the doc table at all', () => {
		expect(table.size).toBeGreaterThan(0);
	});

	it.each(budgets.map((budget) => [budget.label, budget] as const))(
		'states "%s" with the limit the gate enforces',
		(label, budget) => {
			const bytes = budget.maxGzipBytes ?? budget.maxRawBytes;
			expect(bytes, `${budget.id} has no limit`).toBeDefined();
			expect(table.get(label), `doc 20 §6 has no row "${label}"`).toBe((bytes ?? 0) / 1024);
		}
	);

	it('has no row the gate does not enforce', () => {
		const labels = new Set(budgets.map((budget) => budget.label));
		expect([...table.keys()].filter((label) => !labels.has(label))).toEqual([]);
	});
});
