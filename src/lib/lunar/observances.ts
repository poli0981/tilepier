import { lunarOfDate, solarOfLunar, type TpLunarDate, type TpSolarDate } from './amlich';

/**
 * Vietnamese observances that fall on a lunar date (doc 07 §6).
 *
 * A static rule table, not an API — that section says so, and it is the right
 * call twice over: these dates are defined by the lunar calendar rather than
 * announced by anyone, so computing them is exact, offline and free, while
 * fetching them would be none of those.
 *
 * Ids only. The names are Paraglide messages under `widget.calendar.observance.*`
 * (CLAUDE.md rule 8), which also keeps `lib/lunar` free of the message graph so
 * the node tests can read this table without a compiled catalogue.
 *
 * Fixed-date national holidays — 30/4, 1/5, 2/9 — are deliberately absent. They
 * are solar, so the lunar module has nothing to contribute to them, and doc 07
 * §6's list is lunar throughout.
 */

export type TpObservanceId =
	| 'tet'
	| 'nguyen-tieu'
	| 'han-thuc'
	| 'hung-vuong'
	| 'doan-ngo'
	| 'vu-lan'
	| 'trung-thu'
	| 'ong-tao';

export interface TpObservance {
	id: TpObservanceId;
	/** Lunar day of the month it falls on. */
	day: number;
	/** Lunar month, 1–12. None of these fall in a leap month. */
	month: number;
}

/** In lunar-year order, which is the order they are lived in. */
export const OBSERVANCES: readonly TpObservance[] = [
	{ id: 'tet', day: 1, month: 1 },
	{ id: 'nguyen-tieu', day: 15, month: 1 },
	{ id: 'han-thuc', day: 3, month: 3 },
	{ id: 'hung-vuong', day: 10, month: 3 },
	{ id: 'doan-ngo', day: 5, month: 5 },
	{ id: 'vu-lan', day: 15, month: 7 },
	{ id: 'trung-thu', day: 15, month: 8 },
	{ id: 'ong-tao', day: 23, month: 12 }
];

export interface TpUpcomingObservance {
	id: TpObservanceId;
	solar: TpSolarDate;
	lunar: TpLunarDate;
}

/** Sortable, and comparable against another date, without parsing anything. */
function ordinal(date: TpSolarDate): number {
	return date.y * 10_000 + date.m * 100 + date.d;
}

/**
 * The next `count` observances on or after `from`, soonest first.
 *
 * Two lunar years are searched, not one. An observance's *lunar* date is fixed
 * but its solar date is not, and late in a lunar year every entry in the table
 * is already behind — so the year after has to be in the candidate set or the
 * list would run empty each January and refill at Tết.
 *
 * Entries whose solar date falls outside the lunar module's supported range are
 * dropped rather than approximated (doc 07 §6).
 */
export function upcomingObservances(from: TpSolarDate, count = 5): readonly TpUpcomingObservance[] {
	const today = lunarOfDate(from);
	if (today === null) return [];

	const floor = ordinal(from);
	const found: TpUpcomingObservance[] = [];

	for (const lunarYear of [today.year, today.year + 1]) {
		for (const observance of OBSERVANCES) {
			const lunar: TpLunarDate = {
				day: observance.day,
				month: observance.month,
				year: lunarYear,
				leap: false
			};
			const solar = solarOfLunar(lunar);
			if (solar === null || ordinal(solar) < floor) continue;
			found.push({ id: observance.id, solar, lunar });
		}
	}

	found.sort((a, b) => ordinal(a.solar) - ordinal(b.solar));
	return found.slice(0, count);
}
