/**
 * Vietnamese lunar calendar — the Hồ Ngọc Đức algorithm at UTC+7 (doc 07 §6).
 *
 * Ported from QuoteAtlas, where it shipped with the exhaustive vector set now
 * in `__fixtures__/`. Credit and the algorithm's provenance are in `README.md`
 * beside this file (doc 16 §5); the maths below is unchanged from the reviewed
 * original except for repo naming, and **must not be altered without the
 * vectors** (CLAUDE.md, `Layout of interest`).
 *
 * Why in-house rather than `Intl`: the `chinese` calendar computes at UTC+8 and
 * genuinely diverges from the Vietnamese one — the 2007 Tết falls on 17 or 18
 * February depending on which of the two you ask. For an app built around
 * Vietnamese identity (doc 12 §1) that is the one date it most needs right.
 * `Intl`'s `chinese` is still used, as the *oracle* the vectors were checked
 * against, which is a different job entirely.
 *
 * Zero dependencies; astronomical new moon and sun longitude per Jean Meeus.
 * `solarTermDate` from the original is deliberately not carried: nothing in
 * docs 07–09 asks for tiết khí, and knip is CI-blocking on an export with no
 * consumer (doc 20 §4).
 */

const PI = Math.PI;
const SYNODIC = 29.530588853; // mean synodic month (days)

export interface TpLunarDate {
	day: number;
	month: number;
	year: number;
	leap: boolean;
}

export interface TpSolarDate {
	d: number;
	m: number;
	y: number;
}

/** Julian day number from a civil (Gregorian/Julian) date. */
function jdFromDate(dd: number, mm: number, yy: number): number {
	const a = Math.floor((14 - mm) / 12);
	const y = yy + 4800 - a;
	const m = mm + 12 * a - 3;
	let jd =
		dd +
		Math.floor((153 * m + 2) / 5) +
		365 * y +
		Math.floor(y / 4) -
		Math.floor(y / 100) +
		Math.floor(y / 400) -
		32045;
	if (jd < 2299161) {
		jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
	}
	return jd;
}

/** Civil date from a Julian day number. */
function jdToDate(jd: number): TpSolarDate {
	let a: number;
	let b: number;
	let c: number;
	if (jd > 2299160) {
		a = jd + 32044;
		b = Math.floor((4 * a + 3) / 146097);
		c = a - Math.floor((b * 146097) / 4);
	} else {
		b = 0;
		c = jd + 32082;
	}
	const d = Math.floor((4 * c + 3) / 1461);
	const e = c - Math.floor((1461 * d) / 4);
	const m = Math.floor((5 * e + 2) / 153);
	const day = e - Math.floor((153 * m + 2) / 5) + 1;
	const month = m + 3 - 12 * Math.floor(m / 10);
	const year = b * 100 + d - 4800 + Math.floor(m / 10);
	return { d: day, m: month, y: year };
}

/** Julian date of the k-th new moon (astronomical, Meeus). */
function newMoon(k: number): number {
	const t = k / 1236.85;
	const t2 = t * t;
	const t3 = t2 * t;
	const dr = PI / 180;
	let jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * t2 - 0.000000155 * t3;
	jd1 += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * dr);
	const sunM = 359.2242 + 29.10535608 * k - 0.0000333 * t2 - 0.00000347 * t3;
	const moonM = 306.0253 + 385.81691806 * k + 0.0107306 * t2 + 0.00001236 * t3;
	const f = 21.2964 + 390.67050646 * k - 0.0016528 * t2 - 0.00000239 * t3;
	let c1 = (0.1734 - 0.000393 * t) * Math.sin(sunM * dr) + 0.0021 * Math.sin(2 * dr * sunM);
	c1 = c1 - 0.4068 * Math.sin(moonM * dr) + 0.0161 * Math.sin(dr * 2 * moonM);
	c1 = c1 - 0.0004 * Math.sin(dr * 3 * moonM);
	c1 = c1 + 0.0104 * Math.sin(dr * 2 * f) - 0.0051 * Math.sin(dr * (sunM + moonM));
	c1 = c1 - 0.0074 * Math.sin(dr * (sunM - moonM)) + 0.0004 * Math.sin(dr * (2 * f + sunM));
	c1 = c1 - 0.0004 * Math.sin(dr * (2 * f - sunM)) - 0.0006 * Math.sin(dr * (2 * f + moonM));
	c1 = c1 + 0.001 * Math.sin(dr * (2 * f - moonM)) + 0.0005 * Math.sin(dr * (2 * moonM + sunM));
	let deltat: number;
	if (t < -11) {
		deltat = 0.001 + 0.000839 * t + 0.0002261 * t2 - 0.00000845 * t3 - 0.000000081 * t * t3;
	} else {
		deltat = -0.000278 + 0.000265 * t + 0.000262 * t2;
	}
	return jd1 + c1 - deltat;
}

/** Sun's ecliptic longitude (radians, 0..2π) at a Julian day. */
function sunLongitude(jdn: number): number {
	const t = (jdn - 2451545.0) / 36525;
	const t2 = t * t;
	const dr = PI / 180;
	const sunM = 357.5291 + 35999.0503 * t - 0.0001559 * t2 - 0.00000048 * t * t2;
	const l0 = 280.46645 + 36000.76983 * t + 0.0003032 * t2;
	let dl = (1.9146 - 0.004817 * t - 0.000014 * t2) * Math.sin(dr * sunM);
	dl = dl + (0.019993 - 0.000101 * t) * Math.sin(dr * 2 * sunM) + 0.00029 * Math.sin(dr * 3 * sunM);
	let l = (l0 + dl) * dr;
	l = l - PI * 2 * Math.floor(l / (PI * 2));
	return l;
}

/** Sun longitude bucket (0..11) at local midnight of a day number. */
function getSunLongitude(dayNumber: number, timeZone: number): number {
	return Math.floor((sunLongitude(dayNumber - 0.5 - timeZone / 24) / PI) * 6);
}

/** Day (integer JDN) of the k-th new moon in local time. */
function getNewMoonDay(k: number, timeZone: number): number {
	return Math.floor(newMoon(k) + 0.5 + timeZone / 24);
}

/**
 * Start (integer JDN) of the lunar month containing `dayNumber` — the latest new
 * moon on or before it.
 *
 * `k` here is a MEAN-synodic estimate, and a true lunation runs up to ~7 hours
 * either side of the mean, so `k + 1` can overshoot by more than one month near a
 * boundary. The algorithm as usually published steps back exactly once
 * (`if (monthStart > dayNumber) k -= 1`), which is one step short for two days in
 * 1900–2100: 2054-05-07 and 2062-04-09 came out as **lunar day 0**, an impossible
 * date that would have rendered as "ngày 0 tháng 4". Walking back until the new
 * moon is actually on or before the day fixes both.
 *
 * Only the backward direction exists because `floor(…) + 1` can never land below
 * the true index — that would need the real new moon to run a whole synodic month
 * ahead of the mean. The exhaustive day-range invariant in amlich.test.ts is what
 * holds that claim to account across the supported range; MAX_STEPS is a
 * termination guard, not an expected path.
 */
function lunarMonthStart(dayNumber: number, timeZone: number): number {
	const MAX_STEPS = 4;
	let k = Math.floor((dayNumber - 2415021.076998695) / SYNODIC) + 1;
	let steps = 0;
	while (getNewMoonDay(k, timeZone) > dayNumber && steps < MAX_STEPS) {
		k -= 1;
		steps += 1;
	}
	return getNewMoonDay(k, timeZone);
}

/** Day the 11th lunar month (containing the winter solstice) begins in year yy. */
function getLunarMonth11(yy: number, timeZone: number): number {
	const off = jdFromDate(31, 12, yy) - 2415021;
	const k = Math.floor(off / SYNODIC);
	let nm = getNewMoonDay(k, timeZone);
	if (getSunLongitude(nm, timeZone) >= 9) {
		nm = getNewMoonDay(k - 1, timeZone);
	}
	return nm;
}

/** Offset of the leap month after lunar month 11 at `a11`. */
function getLeapMonthOffset(a11: number, timeZone: number): number {
	const k = Math.floor((a11 - 2415021.076998695) / SYNODIC + 0.5);
	// Declared without an initialiser: the loop body assigns it before the
	// condition reads it, and eslint's `no-useless-assignment` is right that a
	// `= 0` here would be written and never read. The original carried one.
	let last: number;
	let i = 1;
	let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
	do {
		last = arc;
		i += 1;
		arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
	} while (arc !== last && i < 14);
	return i - 1;
}

/** Convert a solar (civil) date to the Vietnamese lunar date (UTC+7 default). */
export function convertSolar2Lunar(dd: number, mm: number, yy: number, timeZone = 7): TpLunarDate {
	const dayNumber = jdFromDate(dd, mm, yy);
	const monthStart = lunarMonthStart(dayNumber, timeZone);
	let a11 = getLunarMonth11(yy, timeZone);
	let b11 = a11;
	let lunarYear: number;
	if (a11 >= monthStart) {
		lunarYear = yy;
		a11 = getLunarMonth11(yy - 1, timeZone);
	} else {
		lunarYear = yy + 1;
		b11 = getLunarMonth11(yy + 1, timeZone);
	}
	const lunarDay = dayNumber - monthStart + 1;
	const diff = Math.floor((monthStart - a11) / 29);
	let lunarLeap = false;
	let lunarMonth = diff + 11;
	if (b11 - a11 > 365) {
		const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
		if (diff >= leapMonthDiff) {
			lunarMonth = diff + 10;
			if (diff === leapMonthDiff) {
				lunarLeap = true;
			}
		}
	}
	if (lunarMonth > 12) {
		lunarMonth -= 12;
	}
	if (lunarMonth >= 11 && diff < 4) {
		lunarYear -= 1;
	}
	return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
}

/**
 * Convert a Vietnamese lunar date back to a solar (civil) date (UTC+7 default).
 * Returns `{ d: 0, m: 0, y: 0 }` for a leap month that does not exist that year.
 */
export function convertLunar2Solar(
	lunarDay: number,
	lunarMonth: number,
	lunarYear: number,
	lunarLeap: boolean,
	timeZone = 7
): TpSolarDate {
	let a11: number;
	let b11: number;
	if (lunarMonth < 11) {
		a11 = getLunarMonth11(lunarYear - 1, timeZone);
		b11 = getLunarMonth11(lunarYear, timeZone);
	} else {
		a11 = getLunarMonth11(lunarYear, timeZone);
		b11 = getLunarMonth11(lunarYear + 1, timeZone);
	}
	const k = Math.floor(0.5 + (a11 - 2415021.076998695) / SYNODIC);
	let off = lunarMonth - 11;
	if (off < 0) {
		off += 12;
	}
	if (b11 - a11 > 365) {
		const leapOff = getLeapMonthOffset(a11, timeZone);
		let leapMonth = leapOff - 2;
		if (leapMonth < 0) {
			leapMonth += 12;
		}
		if (lunarLeap && lunarMonth !== leapMonth) {
			return { d: 0, m: 0, y: 0 };
		}
		if (lunarLeap || off >= leapOff) {
			off += 1;
		}
	}
	const monthStart = getNewMoonDay(k + off, timeZone);
	return jdToDate(monthStart + lunarDay - 1);
}

/* ────────────────────────────────────────── the pinned-zone public surface */

/**
 * Every solar-to-lunar *conversion* runs at UTC+7 regardless of where the
 * viewer is (doc 07 §6). A new-moon boundary falls at an instant, so computing
 * it against the browser's own offset would put whole lunar months a day out
 * for anyone abroad — moving Tết for precisely the reader it matters most to.
 * A date converts the same way for everyone; only which date you are on is
 * local.
 *
 * Not exported: it is the default of every converter below, so a caller that
 * wanted it would be about to pass it back in, and knip is CI-blocking on an
 * export nothing imports (doc 20 §4).
 */
const VN_UTC_OFFSET_HOURS = 7;

/** doc 07 §6's range guard. Outside it the vectors say nothing, so neither do we. */
export const SUPPORTED_RANGE = { from: 1900, to: 2100 } as const;

export function isSupportedYear(year: number): boolean {
	return Number.isInteger(year) && year >= SUPPORTED_RANGE.from && year <= SUPPORTED_RANGE.to;
}

/**
 * The lunar date for a **solar calendar date** — what a calendar cell shows.
 * `null` outside doc 07 §6's supported range.
 */
export function lunarOfDate(solar: TpSolarDate): TpLunarDate | null {
	if (!isSupportedYear(solar.y)) return null;
	return convertSolar2Lunar(solar.d, solar.m, solar.y, VN_UTC_OFFSET_HOURS);
}

/**
 * The lunar date of the calendar date an instant falls on, read in the
 * **viewer's own zone**.
 *
 * That is not a contradiction of the pin above, and the distinction is the
 * whole of it: *which* calendar date a viewer is on is a question about their
 * clock, and *what lunar date that calendar date is* is the question this
 * module pins to UTC+7. A printed Vietnamese calendar answers the second for
 * every reader on earth and leaves the first to the reader.
 *
 * Doing it the other way round — showing everyone Vietnam's current lunar day —
 * makes the clock tile contradict itself for eight hours a day in California:
 * the solar date on the line would be the 30th and the lunar date beside it
 * would be the 31st's.
 */
export function lunarOf(at: number | Date): TpLunarDate | null {
	const date = at instanceof Date ? at : new Date(at);
	return lunarOfDate({ d: date.getDate(), m: date.getMonth() + 1, y: date.getFullYear() });
}

/**
 * The solar date a lunar date falls on — the detail panel's converter running
 * backwards. `null` for a leap month that year does not have, and `null` when
 * the answer would fall outside the supported range, so a caller never has to
 * recognise `{ d: 0, m: 0, y: 0 }` as a failure.
 */
export function solarOfLunar(lunar: TpLunarDate): TpSolarDate | null {
	const solar = convertLunar2Solar(
		lunar.day,
		lunar.month,
		lunar.year,
		lunar.leap,
		VN_UTC_OFFSET_HOURS
	);
	if (solar.y === 0) return null;
	return isSupportedYear(solar.y) ? solar : null;
}

/** Julian day number of a solar date — the day-level can-chi cycle counts in
 *  these (see `format.ts`), and nothing else outside this module needs it. */
export function julianDayOf(solar: TpSolarDate): number {
	return jdFromDate(solar.d, solar.m, solar.y);
}
