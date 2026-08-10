import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_POLICY, STOCK_BUDGET, cacheKey, type TpCacheFamily } from './shared-constants';

/**
 * Doc 11 §4 is authoritative for cache TTLs and key names; this file is what
 * makes that true rather than aspirational.
 *
 * CLAUDE.md rule 11 and doc 19 §3.5 both promise "a test asserts this" and
 * "doc-drift breaks CI". A test that only reads the constants module cannot
 * detect doc drift at all — it would pass happily while the doc said something
 * else entirely. So this parses the actual markdown table out of the doc and
 * compares it to the constants. Edit one without the other and this goes red.
 */

const DOC = join(process.cwd(), 'docs', 'internal', '11-WORKER-PROXY.md');

/** Maps the doc's key-prefix column to the constant it governs. */
const ROW_TO_FAMILY: Record<string, TpCacheFamily | [TpCacheFamily, TpCacheFamily]> = {
	'wx:v1:*': 'wx',
	'aqi:v1:*': 'aqi',
	'geo:v1:<lang>:<q-norm>': 'geo',
	'fx:v1:USD': 'fx',
	'fx:snap:<date>': 'fxSnap',
	'cr:tick:v1:<set-hash>': 'crTick',
	// One doc row, two policies: "300 s (5m int) / 900 s (1h+)".
	'cr:kl:v1:<sym>:<int>': ['crKlinesIntraday', 'crKlinesDaily'],
	'st:q:v1:<sym>': 'stQuote',
	'st:se:v1:<sym>:15min': 'stSeries15min',
	'st:se:v1:<sym>:1day': 'stSeries1day',
	'rss:v1:<url-hash>': 'rss'
};

const UNIT_MS: Record<string, number> = {
	s: 1000,
	min: 60_000,
	h: 3_600_000,
	d: 86_400_000
};

/**
 * Drops parenthetical asides before parsing. The doc annotates values inline —
 * "300 s (5m int) / 900 s (1h+)", "21600 s (6 h)", "12 h (capped by upstream
 * next-update)" — and those notes contain durations that are commentary, not
 * policy.
 */
function stripAsides(text: string): string {
	return text.replace(/\([^)]*\)/g, ' ');
}

function toMs(value: string | undefined, unit: string | undefined): number | null {
	if (value === undefined || unit === undefined) return null;
	const multiplier = UNIT_MS[unit];
	if (multiplier === undefined) return null;
	return Number(value) * multiplier;
}

const DURATION = /(\d+)\s*(s|min|h|d)\b/;

/** Parses "600 s", "24 h", "7 d", "10 min" → milliseconds. */
function parseDuration(text: string): number | null {
	const m = DURATION.exec(stripAsides(text));
	return m ? toMs(m[1], m[2]) : null;
}

/** Extracts every policy duration in a cell, in order — the klines row has two. */
function parseAllDurations(text: string): number[] {
	const found: number[] = [];
	for (const m of stripAsides(text).matchAll(new RegExp(DURATION, 'g'))) {
		const ms = toMs(m[1], m[2]);
		if (ms !== null) found.push(ms);
	}
	return found;
}

interface DocRow {
	prefix: string;
	ttlCell: string;
	staleCell: string;
}

function readDocTable(): DocRow[] {
	const md = readFileSync(DOC, 'utf8');
	const section = md.split('## 4. KV cache TTLs')[1];
	expect(section, 'doc 11 §4 heading not found — did the doc get restructured?').toBeDefined();

	const rows: DocRow[] = [];
	for (const line of section!.split('\n')) {
		if (!line.startsWith('|')) {
			if (rows.length) break; // table ended
			continue;
		}
		const cells = line
			.split('|')
			.slice(1, -1)
			.map((c) => c.trim());
		if (cells.length < 3) continue;
		const prefix = /`([^`]+)`/.exec(cells[0] ?? '')?.[1];
		if (!prefix) continue; // header or separator row
		rows.push({ prefix, ttlCell: cells[1] ?? '', staleCell: cells[2] ?? '' });
	}
	return rows;
}

describe('doc 11 §4 cache table', () => {
	const rows = readDocTable();

	it('parses every row of the doc table', () => {
		expect(rows.length).toBe(Object.keys(ROW_TO_FAMILY).length);
	});

	it('covers every family declared in CACHE_POLICY', () => {
		const mapped = new Set(Object.values(ROW_TO_FAMILY).flat());
		expect([...mapped].sort()).toEqual(Object.keys(CACHE_POLICY).sort());
	});

	it.each(rows)('$prefix matches CACHE_POLICY', ({ prefix, ttlCell, staleCell }) => {
		const target = ROW_TO_FAMILY[prefix];
		if (target === undefined) {
			throw new Error(
				`doc 11 §4 has a row \`${prefix}\` with no matching entry in CACHE_POLICY. ` +
					`Add the constant, or remove the row.`
			);
		}

		if (Array.isArray(target)) {
			const [intraday, daily] = target;
			const ttls = parseAllDurations(ttlCell);
			expect(ttls, `expected two TTLs in "${ttlCell}"`).toHaveLength(2);
			expect(CACHE_POLICY[intraday].ttlMs).toBe(ttls[0]);
			expect(CACHE_POLICY[daily].ttlMs).toBe(ttls[1]);
			const stale = parseDuration(staleCell);
			expect(CACHE_POLICY[intraday].staleMs).toBe(stale);
			expect(CACHE_POLICY[daily].staleMs).toBe(stale);
			return;
		}

		const policy = CACHE_POLICY[target];

		// "none (permanent)" — the fx snapshot row.
		if (/none/i.test(ttlCell)) {
			expect(policy.ttlMs).toBe(Infinity);
			expect(policy.staleMs).toBeNull();
			return;
		}

		expect(policy.ttlMs, `TTL for ${prefix}`).toBe(parseDuration(ttlCell));
		expect(policy.staleMs, `stale window for ${prefix}`).toBe(parseDuration(staleCell));
	});
});

describe('cache keys', () => {
	const rows = readDocTable();

	it.each([
		['wx:v1:', cacheKey.weather('w3gvk')],
		['aqi:v1:', cacheKey.airQuality('w3gvk')],
		['geo:v1:', cacheKey.geocode('vi', 'ha-noi')],
		['fx:v1:', cacheKey.fx()],
		['fx:snap:', cacheKey.fxSnapshot('2026-08-10')],
		['cr:tick:v1:', cacheKey.cryptoTicker('abc123')],
		['cr:kl:v1:', cacheKey.cryptoKlines('BTCUSDT', '5m')],
		['st:q:v1:', cacheKey.stockQuote('AAPL')],
		['st:se:v1:', cacheKey.stockSeries('AAPL', '1day')],
		['rss:v1:', cacheKey.rss('deadbeef')]
	])('builder output starts with the doc prefix %s', (prefix, built) => {
		expect(built.startsWith(prefix)).toBe(true);
		// The prefix must actually appear in the doc table, not just in our heads.
		expect(rows.some((r) => r.prefix.startsWith(prefix))).toBe(true);
	});

	it('produces whitespace-free keys (doc 04 §5)', () => {
		const built = [
			cacheKey.weather('w3gvk'),
			cacheKey.geocode('vi', 'ha-noi'),
			cacheKey.stockSeries('AAPL', '15min'),
			cacheKey.cryptoKlines('BTCUSDT', '1h')
		];
		for (const key of built) expect(key).not.toMatch(/\s/);
	});
});

describe('doc 11 §5 stock budget tiers', () => {
	const md = readFileSync(DOC, 'utf8');

	it('matches the tier numbers written in the doc', () => {
		// "At ≥ 720 (90%), stop MISS fetches for *intraday* ... daily series keep
		// going to 780; at 780 full stop until UTC reset."
		expect(md).toContain(String(STOCK_BUDGET.intradayStopAt));
		expect(md).toContain(String(STOCK_BUDGET.dailySeriesStopAt));
	});

	it('tiers are ordered and inside the daily ceiling', () => {
		expect(STOCK_BUDGET.intradayStopAt).toBeLessThan(STOCK_BUDGET.dailySeriesStopAt);
		expect(STOCK_BUDGET.dailySeriesStopAt).toBeLessThan(STOCK_BUDGET.dailyCredits);
	});
});
