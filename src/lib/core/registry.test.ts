import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { widgetLabels } from '$lib/i18n/widget-labels';
import { ICON_PATHS } from '$lib/ui/icons/names';
import { MANIFESTS, getManifest, isOnDeck, listByCategory, type TpRefresh } from './registry';
import { CATEGORY_ORDER, isWidgetId } from './types';

/**
 * The same doc-drift guard `shared-constants.test.ts` uses for doc 11 §4:
 * parse the table out of the markdown and compare it to the code, so editing
 * either side alone turns CI red.
 *
 * Only *registered* manifests are checked. The table lists all fifteen widgets
 * from the start; they land one per week, and a row with no manifest yet is
 * not drift.
 */

interface DocRow {
	id: string;
	category: string;
	min: { w: number; h: number };
	default: { w: number; h: number };
	max: { w: number; h: number };
	multi: boolean;
	refresh: TpRefresh | undefined;
}

function parseSize(cell: string): { w: number; h: number } {
	const [w, h] = cell.trim().split('×').map(Number);
	return { w: w ?? 0, h: h ?? 0 };
}

/** Mirrors the shapes doc 06 §7's refresh column is written in. */
function parseRefresh(cell: string): TpRefresh | undefined {
	const text = cell.trim();
	if (text.startsWith('—')) return undefined;
	if (text === 'midnight') return { kind: 'midnight' };

	const interval = /^interval (\d+) (s|h)(, visibleOnly)?$/.exec(text);
	if (interval === null) throw new Error(`doc 06 §7: unparseable refresh cell "${text}"`);
	const amount = Number(interval[1]);
	const everyMs = interval[2] === 'h' ? amount * 3_600_000 : amount * 1000;
	return interval[3] === undefined
		? { kind: 'interval', everyMs }
		: { kind: 'interval', everyMs, visibleOnly: true };
}

function docRows(): Map<string, DocRow> {
	const source = readFileSync(
		join(process.cwd(), 'docs', 'internal', '06-WIDGET-REGISTRY.md'),
		'utf8'
	);
	const rows = new Map<string, DocRow>();

	for (const line of source.split('\n')) {
		if (!line.startsWith('| ')) continue;
		const cells = line.split('|').map((c) => c.trim());
		// | id | category | min | default | max | multi | refresh | → 9 with the
		// empty edges. Skip the header and the separator.
		if (cells.length !== 9) continue;
		const id = cells[1] ?? '';
		if (!isWidgetId(id)) continue;

		rows.set(id, {
			id,
			category: cells[2] ?? '',
			min: parseSize(cells[3] ?? ''),
			default: parseSize(cells[4] ?? ''),
			max: parseSize(cells[5] ?? ''),
			multi: (cells[6] ?? '').startsWith('yes'),
			refresh: parseRefresh(cells[7] ?? '')
		});
	}

	return rows;
}

describe('doc 06 §7 table', () => {
	const rows = docRows();

	it('parses all fifteen rows, so a silent table edit cannot pass unnoticed', () => {
		expect(rows.size).toBe(15);
	});

	it('matches every registered manifest', () => {
		expect(MANIFESTS.length).toBeGreaterThan(0);

		for (const manifest of MANIFESTS) {
			const row = rows.get(manifest.id);
			expect(row, `no doc 06 §7 row for "${manifest.id}"`).toBeDefined();
			expect(manifest.category).toBe(row?.category);
			expect(manifest.sizes.min).toEqual(row?.min);
			expect(manifest.sizes.default).toEqual(row?.default);
			expect(manifest.sizes.max).toEqual(row?.max);
			expect(manifest.multiInstance).toBe(row?.multi);
			expect(manifest.refresh).toEqual(row?.refresh);
		}
	});
});

describe('manifest invariants', () => {
	it('has unique, known ids', () => {
		const ids = MANIFESTS.map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(isWidgetId(id)).toBe(true);
	});

	it('derives i18nKey from the id', () => {
		for (const manifest of MANIFESTS) {
			expect(manifest.i18nKey).toBe(`widget.${manifest.id}`);
		}
	});

	it('orders sizes min ≤ default ≤ max', () => {
		for (const { id, sizes } of MANIFESTS) {
			expect(sizes.min.w, id).toBeLessThanOrEqual(sizes.default.w);
			expect(sizes.min.h, id).toBeLessThanOrEqual(sizes.default.h);
			expect(sizes.default.w, id).toBeLessThanOrEqual(sizes.max.w);
			expect(sizes.default.h, id).toBeLessThanOrEqual(sizes.max.h);
		}
	});

	it('names an icon that exists', () => {
		for (const manifest of MANIFESTS) {
			expect(Object.keys(ICON_PATHS), manifest.id).toContain(manifest.icon);
		}
	});

	it('has a title and blurb for every registered widget (doc 06 §1)', () => {
		for (const manifest of MANIFESTS) {
			const labels = widgetLabels(manifest.id);
			expect(labels, manifest.id).toBeDefined();
			expect(labels?.title()).toBeTruthy();
			expect(labels?.blurb()).toBeTruthy();
		}
	});
});

describe('lookup', () => {
	it('finds a registered manifest and misses an unknown id', () => {
		expect(getManifest('clock')?.id).toBe('clock');
		// doc 05 §5's unknown-widgetId case: a layout may name a widget this
		// build does not have.
		expect(getManifest('weather')).toBeUndefined();
		expect(getManifest('nonsense')).toBeUndefined();
	});

	it('groups by category in the documented order, dropping empty groups', () => {
		const groups = listByCategory();
		const order = groups.map((g) => g.category);

		expect(order).toEqual(
			[...order].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
		);
		for (const group of groups) expect(group.items.length).toBeGreaterThan(0);
	});

	it('never reports a multiInstance widget as taken', () => {
		// clock is multiInstance: a second one is the point, so a disabled Add
		// button would be wrong (doc 06 §4).
		expect(isOnDeck('clock', [])).toBe(false);
		expect(isOnDeck('clock', ['clock', 'clock'])).toBe(false);
	});

	it('reports nothing for a widget this build does not have', () => {
		// The drawer only lists registered manifests, but a caller reading ids
		// out of a stored layout can ask about anything.
		expect(isOnDeck('calc', ['calc'])).toBe(false);
	});
});
