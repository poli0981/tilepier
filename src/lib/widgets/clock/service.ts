import { foldForSearch } from '$lib/i18n/fold';
import { isValidZone, zoneOffsetMinutes } from '$lib/i18n/fmt';

/**
 * World-clock logic for doc 07 §1's detail view.
 *
 * Everything here is pure over `(instant, zone)` — no runes, no store, no DOM —
 * so the interesting parts (DST, the day/night terminator, offset labels) are
 * testable against fixed timestamps rather than against whatever the runner's
 * clock happens to say.
 */

/** doc 07 §1 renders the tile's extra zones as compact rows; the detail board
 *  shows all of them. The cap exists because this list lives in the layout key,
 *  which doc 05 §1 budgets under 100 KB — and a world clock past a dozen zones
 *  is a different product, not a bigger version of this one. */
export const MAX_ZONES = 12;

/** How many of them the tile shows, at h ≥ 2 (doc 07 §1). */
export const TILE_ZONE_ROWS = 3;

export type TpSolarPhase = 'day' | 'twilight' | 'night';

/**
 * IANA renamed a number of zones; ECMA-402 did not follow, and engines disagree
 * about which name is "canonical".
 *
 * Measured on Node 24 / V8 on 2026-08-27: `Intl.supportedValuesOf('timeZone')`
 * returns `Asia/Saigon`, `Asia/Calcutta` and `Europe/Kiev` — the *backward*
 * names — and `resolvedOptions().timeZone` normalises `Asia/Ho_Chi_Minh`
 * **to** `Asia/Saigon` rather than away from it. Other engines already return
 * the modern names, so the same deck opened in two browsers would otherwise
 * disagree about the spelling of the same zone, and the dedupe in
 * `normaliseZones` would let both through.
 *
 * For this product the Vietnamese row is not a rounding error: a dashboard
 * designed around Vietnamese identity (doc 12 §1, §3) that offers its own
 * users a zone called `Asia/Saigon` has got the one name it most needed right
 * wrong. So every id is pulled through this table on the way in — from the
 * platform, from the picker, and from storage — and the modern name is what is
 * stored and shown. `Intl` accepts both spellings as input, so nothing
 * downstream has to know.
 *
 * Only renames a user could plausibly pick out of the list are here. The full
 * IANA `backward` file is ~120 mostly-historical aliases and is not worth
 * shipping to spell three city names correctly.
 */
const MODERN_ZONE_NAME: Readonly<Record<string, string>> = {
	'Africa/Asmera': 'Africa/Asmara',
	'America/Godthab': 'America/Nuuk',
	'Asia/Calcutta': 'Asia/Kolkata',
	'Asia/Dacca': 'Asia/Dhaka',
	'Asia/Katmandu': 'Asia/Kathmandu',
	'Asia/Rangoon': 'Asia/Yangon',
	'Asia/Saigon': 'Asia/Ho_Chi_Minh',
	'Asia/Thimbu': 'Asia/Thimphu',
	'Atlantic/Faeroe': 'Atlantic/Faroe',
	'Europe/Kiev': 'Europe/Kyiv',
	'Pacific/Ponape': 'Pacific/Pohnpei',
	'Pacific/Truk': 'Pacific/Chuuk'
};

/** The name this app stores and shows for a zone, whichever spelling it arrived
 *  in. Idempotent, so it is safe to apply more than once. */
export function canonicalZone(timeZone: string): string {
	return MODERN_ZONE_NAME[timeZone] ?? timeZone;
}

/**
 * The city half of a zone id, which is what doc 07 §1's ruler shows
 * ("Tokyo +2h") — `America/Argentina/Buenos_Aires` gives "Buenos Aires".
 *
 * Not a Paraglide message and not a candidate to become one: these are place
 * names out of the tz database, the same in both catalogues, and there are four
 * hundred of them. Translating them would mean maintaining a second gazetteer
 * that goes stale every tzdata release.
 */
export function zoneCityLabel(timeZone: string): string {
	const segments = canonicalZone(timeZone).split('/');
	return (segments[segments.length - 1] ?? timeZone).replaceAll('_', ' ');
}

/** The region half, shown under the city so two Springfields are tellable
 *  apart. Empty for single-segment ids like `UTC`. */
export function zoneRegionLabel(timeZone: string): string {
	const segments = canonicalZone(timeZone).split('/');
	return segments.slice(0, -1).join(' / ').replaceAll('_', ' ');
}

/** The viewer's own zone — the hero of the board (doc 07 §1). */
export function homeZone(): string {
	// resolvedOptions().timeZone is a real IANA id in every browser in doc 02
	// §6's matrix, but not necessarily the modern spelling — hence the pull
	// through the table above. The `|| 'UTC'` covers a runtime returning empty.
	return canonicalZone(new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}

/**
 * Every IANA zone the platform knows, so no list ships in the bundle.
 *
 * `Intl.supportedValuesOf` is the whole point: the tz database is already in
 * the browser, kept current by its update cycle, and a vendored copy would be
 * several KB that starts going stale the day it lands.
 */
export function allZones(): readonly string[] {
	try {
		return Intl.supportedValuesOf('timeZone').map(canonicalZone).sort();
	} catch {
		// Older runtimes without supportedValuesOf still format zones fine; they
		// just cannot enumerate. The picker degrades to "type a zone", which is
		// worse than a list but better than a blank panel.
		return [];
	}
}

/**
 * Substring match over the zone id with its separators softened, so "ho chi"
 * and "Ho_Chi" both find `Asia/Ho_Chi_Minh`. Folding is what makes a Vietnamese
 * keyboard's diacritics irrelevant here (`src/lib/i18n/fold.ts`).
 */
export function searchZones(query: string, limit = 40, zones = allZones()): readonly string[] {
	const needle = foldForSearch(query)
		.replace(/[\s_/]+/g, ' ')
		.trim();
	if (needle === '') return zones.slice(0, limit);

	const found: string[] = [];
	for (const zone of zones) {
		if (
			foldForSearch(zone)
				.replace(/[\s_/]+/g, ' ')
				.includes(needle)
		)
			found.push(zone);
		if (found.length === limit) break;
	}
	return found;
}

/**
 * Reads a stored zone list, dropping anything the platform does not recognise.
 *
 * doc 07 §1's edge case: "invalid stored zone → drop + warn". A zone id can
 * disappear between tz database releases, and the layout is user-editable in
 * devtools — neither may take the tile down. The dropped ids come back so the
 * caller can warn once rather than this module reaching for the ring buffer.
 */
export function normaliseZones(value: unknown): { zones: string[]; dropped: string[] } {
	if (!Array.isArray(value)) return { zones: [], dropped: [] };

	const zones: string[] = [];
	const dropped: string[] = [];

	for (const entry of value) {
		if (typeof entry !== 'string') continue;
		// Canonicalise before the dedupe, not after: a deck written by a browser
		// that spells it `Asia/Saigon` and edited by one that spells it
		// `Asia/Ho_Chi_Minh` is one zone, and must not become two rows.
		const zone = canonicalZone(entry);
		if (zones.includes(zone)) continue;
		if (isValidZone(zone)) {
			if (zones.length < MAX_ZONES) zones.push(zone);
		} else {
			dropped.push(entry);
		}
	}

	return { zones, dropped };
}

/** Signed minutes `zone` is ahead of `base` at this instant. Both sides come
 *  from `Intl`, so a DST transition on either shows up correctly. */
export function offsetDeltaMinutes(at: number | Date, zone: string, base: string): number {
	return zoneOffsetMinutes(at, zone) - zoneOffsetMinutes(at, base);
}

/**
 * "+2h", "−3h30", "" for the same offset. The minus is U+2212, not a hyphen:
 * doc 12 §3 puts these next to tabular numerals, and a hyphen is visibly the
 * wrong width beside them.
 *
 * Not a Paraglide message: it is a number and two symbols with no word in it,
 * identical in both locales, and doc 14 §2's no-concatenation rule exists for
 * sentences.
 */
export function offsetLabel(deltaMinutes: number): string {
	if (deltaMinutes === 0) return '';

	const sign = deltaMinutes < 0 ? '−' : '+';
	const total = Math.abs(deltaMinutes);
	const hours = Math.floor(total / 60);
	const minutes = total % 60;

	return minutes === 0 ? `${sign}${hours}h` : `${sign}${hours}h${String(minutes).padStart(2, '0')}`;
}

function wrap180(degrees: number): number {
	return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/**
 * The equation of time in minutes — how far true solar noon runs ahead of or
 * behind mean noon on a given day. Spencer's short form; ±30 s against the
 * real thing, which is far inside what a tint can show.
 */
function equationOfTimeMinutes(at: Date): number {
	const startOfYear = Date.UTC(at.getUTCFullYear(), 0, 1);
	const dayOfYear = Math.floor((at.getTime() - startOfYear) / 86_400_000) + 1;
	const b = (2 * Math.PI * (dayOfYear - 81)) / 364;

	return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * Day, twilight or night in a zone, for the board's tint (doc 07 §1).
 *
 * **What this models, stated plainly, because the limitation is visible.** It
 * computes the subsolar meridian — the longitude where it is true solar noon
 * right now — and asks how far the zone's own meridian is from it. Under 90° is
 * day, 90–96° is civil twilight, beyond that is night.
 *
 * That is the *equatorial* terminator. Latitude is not modelled, and cannot be:
 * an IANA zone id carries no coordinates, and the only ways to get them are a
 * vendored several-KB table or a network call — the first is bundle cost that
 * goes stale, the second is ruled out by doc 07 §1 ("pure astronomy calc, no
 * API") and by CLAUDE.md rule 2. So Reykjavík in June reads "night" at 23:00
 * when it is in fact bright. The detail footer says so rather than letting the
 * tint quietly lie.
 *
 * The zone's longitude is derived from its live UTC offset (15° per hour), good
 * to ±7.5° — half a degree of tint error against a 90° band. The equation of
 * time is included because it is four lines and it is the difference between
 * tracking the sun and tracking the clock.
 */
export function solarPhase(at: number | Date, timeZone: string): TpSolarPhase {
	const date = at instanceof Date ? at : new Date(at);

	const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
	const subsolarLongitude = (12 - utcHours - equationOfTimeMinutes(date) / 60) * 15;

	const zoneLongitude = zoneOffsetMinutes(date, timeZone) / 4;
	const distance = Math.abs(wrap180(zoneLongitude - subsolarLongitude));

	if (distance < 90) return 'day';
	if (distance < 96) return 'twilight';
	return 'night';
}

/**
 * The meeting-planner strip (doc 07 §1): a marker dragged across the day picks
 * an instant, and every zone re-reads from it. Snapping to the half hour is
 * what makes the strip usable with a mouse — and every zone offset in the tz
 * database is a whole number of quarter-hours, so a finer grain would only add
 * jitter.
 */
export const PLANNER_STEP_MINUTES = 30;
export const PLANNER_SPAN_HOURS = 24;

/** Start of the local day in `zone`, as an absolute instant. The planner strip
 *  spans forward from here. */
export function startOfLocalDay(at: number | Date, timeZone: string): number {
	const date = at instanceof Date ? at : new Date(at);
	const offset = zoneOffsetMinutes(date, timeZone);

	// Shift into the zone's wall clock, truncate the day there, shift back.
	const shifted = date.getTime() + offset * 60_000;
	const truncated = Math.floor(shifted / 86_400_000) * 86_400_000;
	return truncated - offset * 60_000;
}
