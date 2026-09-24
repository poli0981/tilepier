/**
 * Feed dates (doc 08 §4: "mixed-date formats (RFC822/ISO) normalized
 * server-side").
 *
 * **Parsed here rather than by `Date.parse`**, for two reasons. Its handling of
 * RFC 822 is implementation-defined, so the Worker and the test runner could
 * disagree about the same string. And an ISO timestamp without a zone is read
 * as *local* time — which on a developer's machine in Hà Nội is seven hours off
 * the Worker's UTC, and would pass every test there while ordering feeds wrongly
 * in production. Every date this file cannot read is `null`, which the tile
 * shows as undated rather than guessing.
 *
 * Three shapes: RFC 822 (RSS), ISO 8601 (Atom, Dublin Core), and .NET's
 * default `M/D/YYYY h:mm:ss AM` — the last because Tuổi Trẻ sends it, measured
 * through the Worker on 2026-09-24 with every one of its thirty items undated
 * until it was read.
 */

const MONTHS: Readonly<Record<string, number>> = {
	jan: 0,
	feb: 1,
	mar: 2,
	apr: 3,
	may: 4,
	jun: 5,
	jul: 6,
	aug: 7,
	sep: 8,
	oct: 9,
	nov: 10,
	dec: 11
};

/**
 * Minutes east of UTC. RFC 822's own names, with its meanings (CST is US
 * Central, not China), plus the few unambiguous ones feeds send that it lacks
 * — ICT among them, for the feeds this app is most likely to hold. Ambiguous
 * abbreviations (IST, BST) are left out on purpose and read as UTC.
 */
const ZONES: Readonly<Record<string, number>> = {
	UT: 0,
	UTC: 0,
	GMT: 0,
	Z: 0,
	EST: -300,
	EDT: -240,
	CST: -360,
	CDT: -300,
	MST: -420,
	MDT: -360,
	PST: -480,
	PDT: -420,
	ICT: 420,
	WIB: 420,
	HKT: 480,
	SGT: 480,
	JST: 540,
	KST: 540,
	AEST: 600,
	AEDT: 660,
	CET: 60,
	CEST: 120,
	EET: 120,
	EEST: 180
};

/** Earlier than this is a feed's placeholder, not a publication date. */
const EARLIEST_YEAR = 1990;

const RFC822 =
	/^(?:[a-z]+,?\s*)?(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4}|\d{2})(?:\s+|,\s*)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(.*)$/i;

const ISO =
	/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;

/** `+0700`, `-05:00`, `+07`, `GMT+7`, `UTC+07:00`, `ICT` — minutes east of UTC;
 *  `undefined` when no zone is written at all; `null` when the text is not a
 *  zone. */
function zoneOffset(text: string): number | null | undefined {
	const zone = text.trim().toUpperCase();
	if (zone === '') return undefined;

	const numeric = /^(?:GMT|UTC|UT)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(zone);
	if (numeric) {
		const hours = Number(numeric[2]);
		const minutes = Number(numeric[3] ?? '0');
		if (hours > 14 || minutes > 59) return null;
		return (numeric[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
	}

	if (Object.hasOwn(ZONES, zone)) return ZONES[zone] ?? null;
	// A zone nobody can resolve (RFC 822's military letters among them) reads as
	// UTC: the date is still worth more than none, and ordering is all it is for.
	return /^[A-Z]{1,5}$/.test(zone) ? 0 : null;
}

function utc(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
	offsetMinutes: number
): number | null {
	if (year < EARLIEST_YEAR || month < 0 || month > 11 || day < 1 || day > 31) return null;
	if (hour > 23 || minute > 59 || second > 60) return null;

	const ms = Date.UTC(year, month, day, hour, minute, Math.min(second, 59));
	// 31 February rolls into March in `Date.UTC`; it is not a date.
	if (new Date(ms).getUTCDate() !== day) return null;
	return ms - offsetMinutes * 60_000;
}

/**
 * `9/24/2026 9:41:00 PM` — what .NET writes by default, and what Tuổi Trẻ
 * sends as its `pubDate` (measured 2026-09-24).
 *
 * Month first when there is an AM/PM, which is the US convention that format
 * comes from. Without one, a number over 12 says which field is the day, and
 * when both could be months the date is `null` rather than a coin toss —
 * `9/10` is September in one country and October in the next.
 */
const SLASHED =
	/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*(.*)$/i;

interface Parts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	/** As written: `undefined` when the date names no zone. */
	zone: number | null | undefined;
}

function partsOf(text: string): Parts | null {
	const iso = ISO.exec(text);
	if (iso) {
		return {
			year: Number(iso[1]),
			month: Number(iso[2]) - 1,
			day: Number(iso[3]),
			hour: Number(iso[4] ?? '0'),
			minute: Number(iso[5] ?? '0'),
			second: Number(iso[6] ?? '0'),
			zone: zoneOffset(iso[7] ?? '')
		};
	}

	const rfc = RFC822.exec(text);
	if (rfc) {
		const month = MONTHS[(rfc[2] ?? '').toLowerCase()];
		if (month === undefined) return null;
		// RFC 2822 §4.3: a two-digit year is 1950–2049.
		const short = Number(rfc[3]);
		const year = (rfc[3] ?? '').length === 2 ? (short < 50 ? 2000 + short : 1900 + short) : short;
		return {
			year,
			month,
			day: Number(rfc[1]),
			hour: Number(rfc[4]),
			minute: Number(rfc[5]),
			second: Number(rfc[6] ?? '0'),
			zone: zoneOffset(rfc[7] ?? '')
		};
	}

	const slashed = SLASHED.exec(text);
	if (slashed) {
		const first = Number(slashed[1]);
		const second = Number(slashed[2]);
		const meridiem = slashed[7]?.toUpperCase();

		let month: number;
		let day: number;
		if (meridiem !== undefined || second > 12) [month, day] = [first, second];
		else if (first > 12) [month, day] = [second, first];
		else return null;

		let hour = Number(slashed[4]);
		if (meridiem !== undefined) {
			if (hour < 1 || hour > 12) return null;
			hour = (hour % 12) + (meridiem === 'PM' ? 12 : 0);
		}

		return {
			year: Number(slashed[3]),
			month: month - 1,
			day,
			hour,
			minute: Number(slashed[5]),
			second: Number(slashed[6] ?? '0'),
			zone: zoneOffset(slashed[8] ?? '')
		};
	}

	return null;
}

/**
 * The zone a date string names, in minutes east of UTC, or `null` when it names
 * none — how `feed-parse.ts` learns the zone a channel writes its own dates in
 * (Tuổi Trẻ's `lastBuildDate` says `GMT+7`; its items say nothing).
 */
export function declaredZone(raw: string | null | undefined): number | null {
	const parts = partsOf(raw?.trim() ?? '');
	return typeof parts?.zone === 'number' ? parts.zone : null;
}

/**
 * Unix ms, or `null` for anything that is not a date this can trust.
 *
 * `assumedZone` is for a date that names no zone: the channel's own zone when
 * it declares one elsewhere, else UTC. Read as UTC, Tuổi Trẻ's items sat seven
 * hours in the future and at the top of every merged list.
 */
export function parseFeedDate(raw: string | null | undefined, assumedZone = 0): number | null {
	const parts = partsOf(raw?.trim() ?? '');
	if (parts === null || parts.zone === null) return null;
	return utc(
		parts.year,
		parts.month,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
		parts.zone ?? assumedZone
	);
}
