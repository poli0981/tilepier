import { julianDayOf, type TpLunarDate, type TpSolarDate } from './amlich';

/**
 * Lunar date strings, both locales (doc 14 §3).
 *
 * Separate from `amlich.ts` on purpose: that file is calendar arithmetic and
 * has no opinion about language, while everything here produces prose. The
 * split is what lets the exhaustive vector suite drive the maths without ever
 * touching a string table.
 *
 * The locale is a parameter rather than a read of `stores/settings`, for the
 * same reason `i18n/fmt.ts` gives: it keeps the module free of runes and of the
 * store graph, so it tests in the node project against fixed inputs.
 */

/** Thiên can — the ten heavenly stems. */
const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'] as const;

/** Địa chi — the twelve earthly branches. */
const CHI = [
	'Tý',
	'Sửu',
	'Dần',
	'Mão',
	'Thìn',
	'Tỵ',
	'Ngọ',
	'Mùi',
	'Thân',
	'Dậu',
	'Tuất',
	'Hợi'
] as const;

/**
 * Vietnamese lunar month names. Not ordinals: the first is *Giêng* and the
 * eleventh and twelfth are *Một* and *Chạp*, which is why this is a table
 * rather than a number with a word in front of it.
 */
const MONTHS = [
	'Giêng',
	'Hai',
	'Ba',
	'Tư',
	'Năm',
	'Sáu',
	'Bảy',
	'Tám',
	'Chín',
	'Mười',
	'Một',
	'Chạp'
] as const;

const ORDINALS = [
	'1st',
	'2nd',
	'3rd',
	'4th',
	'5th',
	'6th',
	'7th',
	'8th',
	'9th',
	'10th',
	'11th',
	'12th',
	'13th',
	'14th',
	'15th',
	'16th',
	'17th',
	'18th',
	'19th',
	'20th',
	'21st',
	'22nd',
	'23rd',
	'24th',
	'25th',
	'26th',
	'27th',
	'28th',
	'29th',
	'30th'
] as const;

function pair(canIndex: number, chiIndex: number): string {
	// Both moduli are taken here rather than at each call site, so a negative
	// intermediate — which the month formula can produce for a year of 0 —
	// cannot index out of the table.
	const can = CAN[((canIndex % 10) + 10) % 10] ?? '';
	const chi = CHI[((chiIndex % 12) + 12) % 12] ?? '';
	return `${can} ${chi}`;
}

/** Can-chi of a lunar **year**, e.g. 2026 → `Bính Ngọ`. */
export function canChiYear(lunarYear: number): string {
	return pair(lunarYear + 6, lunarYear + 8);
}

/**
 * Can-chi of a lunar **month**, e.g. month 1 of 2026 → `Canh Dần`.
 *
 * The branch is fixed by the month number — tháng Giêng is always Dần, tháng
 * Một always Tý, tháng Chạp always Sửu — and the stem follows the *year's*
 * stem by the ngũ hổ độn rule (a Bính year opens with Canh, an Ất year with
 * Mậu). The arithmetic below is that rule; `format.test.ts` checks it against
 * the rule's own five lines rather than against this function's output.
 *
 * A leap month carries the same can-chi as the month it repeats: it is the
 * same branch position in the year, which is what makes it a *repeat*.
 */
export function canChiMonth(lunarYear: number, lunarMonth: number): string {
	return pair(lunarYear * 12 + lunarMonth + 3, lunarMonth + 1);
}

/**
 * Can-chi of a **day**. The day cycle is continuous — it has run unbroken
 * across every calendar reform — so it is counted in Julian days rather than
 * derived from the lunar date. Anchor a reader can check: 1 January 2000 is
 * JDN 2 451 545 (the J2000 epoch) and is a Mậu Ngọ day.
 */
export function canChiDay(solar: TpSolarDate): string {
	const jd = julianDayOf(solar);
	return pair(jd + 9, jd + 1);
}

export type TpLunarLocale = 'vi' | 'en';

/**
 * The name of a lunar month on its own — `tháng Bảy`, or `7th lunar month`.
 * The calendar header needs it without a day attached, which is the one thing
 * neither formatter below can give it.
 */
export function lunarMonthName(month: number, locale: TpLunarLocale, leap = false): string {
	if (locale === 'en') {
		const ordinal = ORDINALS[month - 1] ?? String(month);
		return leap ? `${ordinal} leap lunar month` : `${ordinal} lunar month`;
	}
	const name = MONTHS[month - 1] ?? String(month);
	return leap ? `tháng ${name} (nhuận)` : `tháng ${name}`;
}

/**
 * The compact form the clock tile and the calendar header carry (doc 14 §3):
 * `08/07 Bính Ngọ` in Vietnamese, `7th day, 7th lunar month` in English.
 *
 * Can-chi appears only in the Vietnamese form. That is doc 14 §3's call, and
 * it is the right one: a can-chi year is a piece of Vietnamese cultural
 * literacy, not information, and transliterating it into an English line buys
 * an English reader nothing they can use.
 */
export function fmtLunarShort(lunar: TpLunarDate, locale: TpLunarLocale): string {
	if (locale === 'en') {
		const day = ORDINALS[lunar.day - 1] ?? String(lunar.day);
		const month = ORDINALS[lunar.month - 1] ?? String(lunar.month);
		return lunar.leap
			? `${day} day, ${month} leap lunar month`
			: `${day} day, ${month} lunar month`;
	}

	const day = String(lunar.day).padStart(2, '0');
	const month = String(lunar.month).padStart(2, '0');
	// Zero-padded so the line does not reflow between the 9th and the 10th —
	// it sits under a clock that is already mono and already fixed-width.
	return `${day}/${month}${lunar.leap ? 'N' : ''} ${canChiYear(lunar.year)}`;
}

/**
 * The spelled-out form the calendar's lunar panel shows:
 * `ngày 22 tháng Năm (nhuận), Bính Ngọ`.
 */
export function fmtLunarLong(lunar: TpLunarDate, locale: TpLunarLocale): string {
	if (locale === 'en') {
		const day = ORDINALS[lunar.day - 1] ?? String(lunar.day);
		const month = ORDINALS[lunar.month - 1] ?? String(lunar.month);
		const leap = lunar.leap ? ' (leap)' : '';
		return `${day} day of the ${month} lunar month${leap}, ${canChiYear(lunar.year)}`;
	}

	const month = MONTHS[lunar.month - 1] ?? String(lunar.month);
	const leap = lunar.leap ? ' (nhuận)' : '';
	return `ngày ${String(lunar.day)} tháng ${month}${leap}, ${canChiYear(lunar.year)}`;
}
