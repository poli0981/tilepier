import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	CACHE_POLICY,
	FEED_URL_MAX_LENGTH,
	STOCK_BUDGET,
	cacheKey,
	feedUrlHash,
	geohash,
	parseFeedUrl,
	roundCoord,
	symbolSetKey,
	canonicalSymbols,
	isMarketSymbol,
	MARKETS_MAX_SYMBOLS,
	type TpCacheFamily
} from './shared-constants';
import { parseCoords } from '../routes/api/_lib/geohash';

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
	'cr:tick:v1:<set>': 'crTick',
	// One doc row, two policies: "300 s (5m int) / 900 s (1h+)".
	'cr:kl:v1:<sym>:<int>': ['crKlinesIntraday', 'crKlinesDaily'],
	'st:q:v1:<sym>': 'stQuote',
	// The client's set entry takes the per-symbol policy (doc 11 §4).
	'st:qs:v1:<set>': 'stQuote',
	'st:se:v1:<sym>:15min': 'stSeries15min',
	'st:se:v1:<sym>:1day': 'stSeries1day',
	'st:sr:v1:<q-norm>': 'stSearch',
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
		['st:qs:v1:', cacheKey.stockQuotes('AAPL,MSFT')],
		['st:se:v1:', cacheKey.stockSeries('AAPL', '1day')],
		['st:sr:v1:', cacheKey.stockSearch('apple')],
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

describe('coordinates (doc 04 §5, doc 15 §7)', () => {
	// These two moved out of `routes/api/_lib/geohash.ts` in Week 4. Doc 03 does
	// not let a widget import from `routes/api`, so while they lived there the
	// client could not name the entry it was subscribing to — and doc 04 §5's
	// whole point is that it is the *same* string on both sides.

	it('rounds to 2 dp, so a precise location is coarsened before it is used', () => {
		expect(roundCoord(21.028511)).toBe(21.03);
		expect(roundCoord(105.804817)).toBe(105.8);
	});

	it('collapses nearby coordinates onto one cache key', () => {
		// The quota model in doc 11 §5 rests on this: everyone in a city shares
		// one entry.
		const hanoi = geohash(21.03, 105.8);
		const alsoHanoi = geohash(21.01, 105.82);
		expect(hanoi).toBe(alsoHanoi);
		expect(geohash(48.86, 2.35)).not.toBe(hanoi);
		expect(hanoi).toHaveLength(5);
	});

	it('spells the same key on both sides, from an unrounded coordinate', () => {
		// The one that matters, and the one a copy of these functions would have
		// broken: **round, then hash**. Hashing first and rounding after agrees
		// everywhere except near a cell edge, which is exactly where a divergence
		// would never be noticed — the tile would work, and its `apiCache` row and
		// the Worker's KV row would simply be different entries.
		const raw = { lat: 21.028511, lon: 105.804817 };

		// What a widget will compute, with nothing but `$lib`.
		const client = cacheKey.weather(geohash(roundCoord(raw.lat), roundCoord(raw.lon)));

		// What `routes/api/weather/+server.ts` computes, through the same path it
		// actually takes: `parseCoords` rounds, then `geohash` hashes.
		const url = new URL(`https://tilepier.win/api/weather?lat=${raw.lat}&lon=${raw.lon}`);
		const coords = parseCoords(url);
		expect(coords).not.toBeNull();
		const server = cacheKey.weather(geohash(coords!.lat, coords!.lon));

		expect(client).toBe(server);
	});

	it('rounding before hashing is not the same as hashing before rounding', () => {
		// Guards the assertion above against passing for the wrong reason. If this
		// ever stops finding a disagreement, the case is no longer near a cell edge
		// and needs new coordinates rather than deleting.
		const lat = 33.395537;
		const lon = 43.143213;
		expect(geohash(roundCoord(lat), roundCoord(lon))).toBe('svywj');
		expect(geohash(lat, lon)).toBe('svytv');
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

/**
 * doc 04 §5's 1:1 guarantee, applied to a *set* rather than to a point.
 *
 * `geohash` has the "round, then hash" ordering assertion below because getting
 * the order wrong breaks the guarantee only at cell edges. This is the same
 * hazard with a different shape: two watchlists holding the same coins in a
 * different order are the same question, and a key builder that did not sort
 * would file one question's answer under two entries — halving the hit rate and
 * doubling the calls to upstream, with nothing anywhere to say so.
 */
describe('symbol sets (doc 10 §5, doc 11 §4)', () => {
	it('is order-independent, which is the whole reason it sorts', () => {
		expect(symbolSetKey(['ETHUSDT', 'BTCUSDT'])).toBe(symbolSetKey(['BTCUSDT', 'ETHUSDT']));
		expect(symbolSetKey(['ETHUSDT', 'BTCUSDT'])).toBe('BTCUSDT,ETHUSDT');
	});

	it('folds case and surrounding space, because a watchlist is hand-edited', () => {
		expect(symbolSetKey([' btcusdt '])).toBe(symbolSetKey(['BTCUSDT']));
	});

	it('de-duplicates, so one coin listed twice is still one cache entry', () => {
		expect(symbolSetKey(['BTCUSDT', 'BTCUSDT'])).toBe('BTCUSDT');
	});

	it('drops anything outside doc 10 §5 rather than sending it upstream', () => {
		// `canonicalSymbols` also builds keys from watchlists read out of
		// storage, where a hand-edited entry can be anything at all — so it fails
		// closed. The endpoint's validator refuses those before they reach here,
		// which is what keeps a typo reportable instead of silent.
		expect(canonicalSymbols(['BTC USDT', 'BTC/USDT', '', 'TOOLONGSYMBOL1'])).toEqual([]);
		expect(canonicalSymbols(['BTC-USD', 'BRK.B'])).toEqual(['BRK.B', 'BTC-USD']);
	});

	it('agrees with the allowlist the endpoints validate against', () => {
		expect(isMarketSymbol('BTCUSDT')).toBe(true);
		expect(isMarketSymbol('BRK.B')).toBe(true);
		expect(isMarketSymbol('btcusdt')).toBe(false);
		expect(isMarketSymbol('TOOLONGSYMBOL')).toBe(false);
		expect(isMarketSymbol('')).toBe(false);
	});

	it('stays inside the KV key limit at the documented cap', () => {
		// doc 09 §1 caps a watchlist at twelve and the allowlist caps a symbol at
		// twelve characters, which is what makes the literal set safe to use as a
		// key instead of a hash. KV allows 512 bytes.
		const widest = Array.from({ length: MARKETS_MAX_SYMBOLS }, (_, i) =>
			`${String(i).padStart(2, '0')}ABCDEFGHIJ`.slice(0, 12)
		);
		expect(cacheKey.cryptoTicker(symbolSetKey(widest)).length).toBeLessThan(512);
	});
});

/**
 * doc 15 §5's URL rules. Each rule has a case of its own and the case names
 * the rule's reason, so deleting a rule turns exactly its row red rather than
 * leaving a neighbour to fail for it (the Week 4b lesson: an assertion that
 * passes through a different branch is not testing the one it names).
 */
describe('feed URLs (doc 15 §5)', () => {
	it('accepts an ordinary https feed and returns its canonical spelling', () => {
		expect(parseFeedUrl('https://vnexpress.net/rss/tin-moi-nhat.rss')).toEqual({
			ok: true,
			url: 'https://vnexpress.net/rss/tin-moi-nhat.rss'
		});
	});

	it.each([
		['surrounding space', '  https://example.com/feed.xml  ', 'https://example.com/feed.xml'],
		['upper-case scheme and host', 'HTTPS://Example.COM/Feed.xml', 'https://example.com/Feed.xml'],
		['the default port', 'https://example.com:443/feed', 'https://example.com/feed'],
		['a fragment', 'https://example.com/feed#latest', 'https://example.com/feed'],
		['an empty query', 'https://example.com/feed?', 'https://example.com/feed'],
		['a trailing dot on the host', 'https://example.com./feed', 'https://example.com/feed'],
		['a Unicode host', 'https://ví-dụ.vn/rss', 'https://xn--v-d-rma6749a.vn/rss']
	])('canonicalises %s', (_name, raw, canonical) => {
		expect(parseFeedUrl(raw)).toEqual({ ok: true, url: canonical });
	});

	it('keeps the path and the query exactly, because either can name another feed', () => {
		const check = parseFeedUrl('https://example.com/Feed?tag=A&page=2');
		expect(check).toEqual({ ok: true, url: 'https://example.com/Feed?tag=A&page=2' });
	});

	it('refuses a URL longer than FEED_URL_MAX_LENGTH', () => {
		const long = `https://example.com/${'a'.repeat(FEED_URL_MAX_LENGTH)}`;
		expect(parseFeedUrl(long)).toEqual({ ok: false, reason: 'invalid' });
	});

	it.each([
		['', 'invalid'],
		['not a url', 'invalid'],
		['http://example.com/feed', 'scheme'],
		['ftp://example.com/feed', 'scheme'],
		['javascript:alert(1)', 'scheme'],
		['https://user:pass@example.com/feed', 'credentials'],
		['https://user@example.com/feed', 'credentials'],
		['https://example.com:8443/feed', 'port'],
		['https://127.0.0.1/feed', 'address'],
		// WHATWG turns every one of these into 127.0.0.1 before anything looks at
		// the host, which is why the rule reads the parsed host, never the text.
		['https://2130706433/feed', 'address'],
		['https://0x7f.1/feed', 'address'],
		['https://127.1/feed', 'address'],
		['https://[::1]/feed', 'address'],
		['https://[fd00::1]/feed', 'address'],
		// A single label that is on no blocklist: only the one-label rule can
		// refuse it. Found by removing that rule and watching every other case
		// here stay green — `localhost` and `intranet` are refused by the suffix
		// list first, so they never reached it.
		['https://myserver/feed', 'host'],
		['https://localhost/feed', 'host'],
		['https://localhost./feed', 'host'],
		['https://intranet/feed', 'host'],
		['https://printer.local/feed', 'host'],
		['https://api.internal/feed', 'host'],
		['https://router.home.arpa/feed', 'host'],
		['https://nas.lan/feed', 'host'],
		['https://site.test/feed', 'host'],
		['https://hidden.onion/feed', 'host'],
		['https://tilepier.win/api/rss', 'host'],
		['https://preview.tilepier.win/feed', 'host']
	])('refuses %s as %s', (raw, reason) => {
		expect(parseFeedUrl(raw)).toEqual({ ok: false, reason });
	});

	it('refuses the host the Worker is answering on, whatever it is called', () => {
		// A workers.dev preview is not tilepier.win, and must not fetch itself either.
		expect(
			parseFeedUrl('https://tilepier.demo.workers.dev/api/rss', 'tilepier.demo.workers.dev')
		).toEqual({ ok: false, reason: 'host' });
		expect(
			parseFeedUrl('https://someone-else.workers.dev/feed', 'tilepier.demo.workers.dev')
		).toEqual({
			ok: true,
			url: 'https://someone-else.workers.dev/feed'
		});
	});

	it('lets a host that merely starts with a number through, for the platform to judge', () => {
		// `10.0.0.1.nip.io` resolves to a private address, and no pattern can see
		// that. doc 15 §5 leaves it to the Worker platform, which has no route to
		// RFC 1918 space; the production probe in doc 19 §5 is what checks it.
		expect(parseFeedUrl('https://10.0.0.1.nip.io/feed')).toEqual({
			ok: true,
			url: 'https://10.0.0.1.nip.io/feed'
		});
	});
});

describe('feed cache keys (doc 11 §4, doc 04 §5)', () => {
	it('is SHA-256 of the canonical URL, in hex', async () => {
		const url = 'https://vnexpress.net/rss/tin-moi-nhat.rss';
		const expected = createHash('sha256').update(url).digest('hex');
		expect(await feedUrlHash(url)).toBe(expected);
		expect(expected).toHaveLength(64);
	});

	it('files two spellings of one feed under one key, once canonicalised', async () => {
		const a = parseFeedUrl('HTTPS://VnExpress.net:443/rss/tin-moi-nhat.rss#top');
		const b = parseFeedUrl('https://vnexpress.net/rss/tin-moi-nhat.rss');
		expect(a.ok && b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(await feedUrlHash(a.url)).toBe(await feedUrlHash(b.url));
	});

	it('stays inside the KV key limit', async () => {
		const key = cacheKey.rss(await feedUrlHash('https://example.com/feed'));
		expect(`kv:${key}`.length).toBeLessThan(512);
		expect(key).toMatch(/^rss:v1:[0-9a-f]{64}$/);
	});
});
