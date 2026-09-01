/**
 * Locale-aware date and time formatting (doc 14 §3: never hand-roll).
 *
 * Pure by design — the locale is a parameter rather than a read of
 * `stores/settings`. That keeps this module free of runes and of the store
 * graph, so it tests in the node project against fixed inputs instead of
 * needing a hydrated app, and it lets the one caller that legitimately wants a
 * *different* locale from the app's (nothing yet; the bilingual prerender of
 * doc 14 §6 is the shape that will) ask for one.
 *
 * Each export landed with its first consumer, not before — knip is CI-blocking
 * on an unused one (doc 20 §5). `fmtTime`/`fmtDate` arrived with the world
 * clock, `fmtRelative` with the notes tile's updated-ago line.
 */

/**
 * Constructing an `Intl.DateTimeFormat` is the expensive part — roughly two
 * orders of magnitude more than formatting with one — and the world-clock
 * detail (doc 07 §1) formats every added zone once a second. Memoise on the
 * full option set, because two formatters differing only in `timeZone` are two
 * different formatters.
 *
 * Unbounded on purpose: the key space is locales × zones × two booleans, and a
 * deck cannot reach a size where that matters. A cap here would be a cache
 * eviction policy protecting nothing.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
	locale: string,
	key: string,
	options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
	const cacheKey = `${locale}|${key}`;
	const hit = formatters.get(cacheKey);
	if (hit !== undefined) return hit;

	const made = new Intl.DateTimeFormat(locale, options);
	formatters.set(cacheKey, made);
	return made;
}

interface TimeOptions {
	/** Defaults to the app's `clock24h` setting at the call site, not here. */
	hour12?: boolean;
	seconds?: boolean;
	/** IANA zone. Omitted means the viewer's own. */
	timeZone?: string;
}

interface DateOptions {
	/** `short` gives "Sat 30/08"; `long` gives the full weekday and month. */
	weekday?: 'short' | 'long' | 'none';
	timeZone?: string;
}

export function fmtTime(at: number | Date, locale: string, options: TimeOptions = {}): string {
	const { hour12 = false, seconds = false, timeZone } = options;

	return formatter(locale, `t:${hour12}:${seconds}:${timeZone ?? ''}`, {
		hour: '2-digit',
		minute: '2-digit',
		...(seconds ? { second: '2-digit' } : {}),
		...(timeZone === undefined ? {} : { timeZone }),
		hour12
	}).format(at);
}

export function fmtDate(at: number | Date, locale: string, options: DateOptions = {}): string {
	const { weekday = 'short', timeZone } = options;

	return formatter(locale, `d:${weekday}:${timeZone ?? ''}`, {
		...(weekday === 'none' ? {} : { weekday }),
		day: '2-digit',
		month: '2-digit',
		...(timeZone === undefined ? {} : { timeZone })
	}).format(at);
}

/**
 * The zone's offset from UTC in minutes at a given instant.
 *
 * Derived from `Intl`, never from arithmetic on a stored number — doc 07 §1's
 * DST edge case is exactly this: an offset is a property of a zone *at an
 * instant*, and half the world changes it twice a year. `formatToParts` with
 * `longOffset` yields "GMT+07:00" (or bare "GMT" at zero), which is the only
 * way to read a real offset back out of the platform's own tz database.
 *
 * Lives here rather than in the clock widget because it is a formatting
 * primitive over `Intl`, and doc 03 §1 sends cross-widget reuse into `core` or
 * a shared lib rather than leaving the second caller to copy it.
 */
export function zoneOffsetMinutes(at: number | Date, timeZone: string): number {
	const parts = formatter(`en-US`, `o:${timeZone}`, {
		timeZone,
		timeZoneName: 'longOffset'
	}).formatToParts(at);

	const label = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
	const match = /GMT([+-])(\d{2}):(\d{2})/.exec(label);
	// Bare "GMT" is UTC itself, and is what Etc/UTC and Europe/London-in-winter
	// report. It is not a parse failure.
	if (match === null) return 0;

	const sign = match[1] === '-' ? -1 : 1;
	return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** True when the platform's tz database knows the zone. A zone stored by an
 *  older build, or hand-edited into the layout, must not take the tile down —
 *  doc 07 §1 says drop it and warn. */
export function isValidZone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return true;
	} catch {
		return false;
	}
}

/**
 * Relative time, through `Intl.RelativeTimeFormat` (doc 14 §3: never
 * hand-roll). "3 minutes ago", "in 2 days" — and, crucially, whatever those
 * are in Vietnamese, which is not the English sentence with the words swapped.
 *
 * The unit is chosen by magnitude rather than by a table of thresholds, and
 * the boundary doc 14 §6 calls out is the reason `Math.round` is not used for
 * the seconds case: 59 seconds must read as under a minute, not as "1 minute
 * ago" — a note saved this second should not claim to be a minute old.
 */
const RELATIVE_UNITS: readonly {
	limitMs: number;
	perMs: number;
	unit: Intl.RelativeTimeFormatUnit;
}[] = [
	{ limitMs: 60_000, perMs: 1000, unit: 'second' },
	{ limitMs: 3_600_000, perMs: 60_000, unit: 'minute' },
	{ limitMs: 86_400_000, perMs: 3_600_000, unit: 'hour' },
	{ limitMs: 7 * 86_400_000, perMs: 86_400_000, unit: 'day' },
	{ limitMs: 30 * 86_400_000, perMs: 7 * 86_400_000, unit: 'week' },
	{ limitMs: 365 * 86_400_000, perMs: 30 * 86_400_000, unit: 'month' },
	{ limitMs: Infinity, perMs: 365 * 86_400_000, unit: 'year' }
];

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

export function fmtRelative(at: number | Date, locale: string, now: number = Date.now()): string {
	const target = at instanceof Date ? at.getTime() : at;
	const deltaMs = target - now;
	const magnitude = Math.abs(deltaMs);

	const step =
		RELATIVE_UNITS.find((candidate) => magnitude < candidate.limitMs) ??
		RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
	// The fallback is unreachable — the last row's limit is Infinity — but
	// noUncheckedIndexedAccess is right to insist, and a `!` here would be the
	// one place in this file that asserts rather than proves.
	if (step === undefined) return '';

	let formatter = relativeFormatters.get(locale);
	if (formatter === undefined) {
		formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
		relativeFormatters.set(locale, formatter);
	}

	// Truncated toward zero, so 59 s is "0 seconds"/"now" rather than a minute,
	// and 90 minutes is "1 hour" rather than two.
	return formatter.format(Math.trunc(deltaMs / step.perMs), step.unit);
}

/* ────────────────────────────────────────── numbers and money (doc 14 §3) */

/**
 * Memoised for the same reason the date formatters are: constructing an
 * `Intl.NumberFormat` costs orders of magnitude more than using one, and the
 * currency detail formats a table of them on every keystroke.
 */
const numberFormatters = new Map<string, Intl.NumberFormat>();

function numberFormatter(key: string, build: () => Intl.NumberFormat): Intl.NumberFormat {
	const hit = numberFormatters.get(key);
	if (hit !== undefined) return hit;

	const made = build();
	numberFormatters.set(key, made);
	return made;
}

/**
 * An amount of money, rounded the way that currency is written.
 *
 * doc 08 §2 asks for "display rounding per currency minor units; VND has 0
 * decimals", and **ICU already knows that** — `style: 'currency'` reads it out
 * of CLDR. A hand-written minor-units table would be a second, staler copy of
 * data the platform ships, which is what doc 14 §3's "never hand-roll" is
 * about.
 *
 * `narrowSymbol` per doc 14 §3, with one guard: it throws `RangeError` on
 * engines that predate it, and an unknown code throws whatever `Intl` feels
 * like. Either way the fallback is the plain symbol, and past that the code
 * itself — a tile that renders "1000 XXX" is worse than one that renders a
 * symbol nobody recognises, and both are far better than one that crashes.
 */
export function fmtCurrency(value: number, currency: string, locale: string): string {
	try {
		return numberFormatter(
			`c:${locale}:${currency}`,
			() =>
				new Intl.NumberFormat(locale, {
					style: 'currency',
					currency,
					currencyDisplay: 'narrowSymbol'
				})
		).format(value);
	} catch {
		try {
			return numberFormatter(
				`cs:${locale}:${currency}`,
				() => new Intl.NumberFormat(locale, { style: 'currency', currency })
			).format(value);
		} catch {
			return `${fmtRate(value, locale)} ${currency}`;
		}
	}
}

/**
 * A rate, which is not a price and must not be rounded like one.
 *
 * Significant digits rather than fraction digits, because a rate's magnitude is
 * not the currency's. VND per USD is ~26,000 and JPY per VND is ~0.006; asking
 * for two decimals renders the first as noise and the second as zero. Six
 * significant digits covers both and is what a bank board shows.
 */
export function fmtRate(rate: number, locale: string): string {
	return numberFormatter(
		`r:${locale}`,
		() => new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 })
	).format(rate);
}

/**
 * A price, at a precision chosen by the caller (doc 09 §1).
 *
 * Separate from `fmtRate` rather than an option on it, because the two answer
 * different questions. `fmtRate` is `maximumSignificantDigits: 6`, which is
 * right for an exchange rate spanning 0.000043 to 25 951 — and wrong for a
 * price, where it renders 62 910.53 as "62,910.5" and drops the cents. Here the
 * caller knows the asset and passes the places: doc 09 §1's "BTC 2 dp, sub-$1
 * alts 4-6 dp, stocks 2 dp".
 *
 * `minimumFractionDigits` matches the maximum so a column of prices lines up —
 * "3,241.00" under "62,910.53" rather than "3,241".
 */
export function fmtPrice(value: number, locale: string, digits: number): string {
	return numberFormatter(
		`p:${locale}:${String(digits)}`,
		() =>
			new Intl.NumberFormat(locale, {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits
			})
	).format(value);
}

/**
 * A move, as a signed percentage.
 *
 * Takes a fraction, because that is what `style: 'percent'` wants and letting
 * Intl place the sign and the symbol is the difference between "+0,21 %" in
 * Vietnamese and a hand-built string that is right in exactly one locale.
 *
 * `signDisplay: 'exceptZero'` because "+0.00 %" claims a rise that did not
 * happen, and a bare "0 %" is the honest way to say a rate held.
 */
export function fmtPercentChange(fraction: number, locale: string): string {
	return numberFormatter(
		`p:${locale}`,
		() =>
			new Intl.NumberFormat(locale, {
				style: 'percent',
				signDisplay: 'exceptZero',
				maximumFractionDigits: 2
			})
	).format(fraction);
}
