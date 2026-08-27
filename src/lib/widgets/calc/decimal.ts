/**
 * Exact decimal arithmetic for the calculator (doc 07 §3: "shunting-yard on
 * decimal-safe integer math (scale by 10^n, cap 12 significant digits) — no
 * float chaining, no `eval`, no mathjs dependency").
 *
 * A value is a `bigint` and a scale: `v / 10^s`. Every operation is exact
 * except division, which cannot be, and which is therefore the only place a
 * rounding rule is stated. `0.1 + 0.2` is `0.3` here, not `0.30000000000000004`
 * — which is the entire reason this file exists rather than a `+`.
 */

export interface TpDecimal {
	/** Unscaled value. */
	v: bigint;
	/** Decimal places: the real value is `v / 10n ** BigInt(s)`. May be
	 *  negative, which means trailing zeros the digits do not carry. */
	s: number;
}

/** doc 07 §3's cap. Twelve is what fits a calculator display without lying.
 *  Not exported: nothing outside this file should be doing its own rounding,
 *  and knip is CI-blocking on an export with no consumer (doc 20 §5). */
const MAX_SIGNIFICANT = 12;

export const ZERO: TpDecimal = { v: 0n, s: 0 };

function pow10(n: number): bigint {
	return 10n ** BigInt(n);
}

function abs(v: bigint): bigint {
	return v < 0n ? -v : v;
}

function digitCount(v: bigint): number {
	return v === 0n ? 1 : abs(v).toString().length;
}

/** Drops trailing zeros that the scale is only there to cancel, so `1.50` and
 *  `1.5` are the same value and compare equal. Internal: every exported
 *  operation normalises its own result. */
function normalise(d: TpDecimal): TpDecimal {
	if (d.v === 0n) return ZERO;

	let { v, s } = d;
	while (s > 0 && v % 10n === 0n) {
		v /= 10n;
		s -= 1;
	}
	return { v, s };
}

/**
 * Rounds to `MAX_SIGNIFICANT` digits, half away from zero — the rule a person
 * doing this on paper would use, and the one every pocket calculator uses.
 * Banker's rounding is right for accounting and surprising here.
 */
export function roundSignificant(d: TpDecimal, significant = MAX_SIGNIFICANT): TpDecimal {
	const digits = digitCount(d.v);
	if (digits <= significant) return normalise(d);

	const drop = digits - significant;
	const divisor = pow10(drop);
	const negative = d.v < 0n;
	const magnitude = abs(d.v);

	let quotient = magnitude / divisor;
	// Half away from zero. The comparison is on the magnitude and the sign is
	// restored below, so both directions round the same distance — which is
	// what stops `-0.5` and `0.5` disagreeing about which way is "up".
	// `divisor` is a power of ten and therefore even, so half of it is exact.
	if (magnitude % divisor >= divisor / 2n) quotient += 1n;

	return normalise({ v: negative ? -quotient : quotient, s: d.s - drop });
}

/** Brings two values onto a common scale so they can be added or compared. */
function align(a: TpDecimal, b: TpDecimal): { av: bigint; bv: bigint; s: number } {
	const s = Math.max(a.s, b.s);
	return { av: a.v * pow10(s - a.s), bv: b.v * pow10(s - b.s), s };
}

export function add(a: TpDecimal, b: TpDecimal): TpDecimal {
	const { av, bv, s } = align(a, b);
	return roundSignificant({ v: av + bv, s });
}

export function subtract(a: TpDecimal, b: TpDecimal): TpDecimal {
	const { av, bv, s } = align(a, b);
	return roundSignificant({ v: av - bv, s });
}

export function multiply(a: TpDecimal, b: TpDecimal): TpDecimal {
	return roundSignificant({ v: a.v * b.v, s: a.s + b.s });
}

export function negate(a: TpDecimal): TpDecimal {
	return { v: -a.v, s: a.s };
}

export function isZero(a: TpDecimal): boolean {
	return a.v === 0n;
}

/** Two guard digits past the cap, so the final rounding has something to round
 *  *on*. Without them a quotient truncates to twelve digits instead of
 *  rounding to them, and the last one is wrong as often as not. */
const GUARD = MAX_SIGNIFICANT + 2;

/**
 * Division, and the only operation here that has to round.
 *
 * The numerator is scaled so the integer quotient carries `GUARD` *significant
 * digits* — which is not the same as `GUARD` decimal places, and the
 * difference is a real bug this got wrong first. Scaling by a fixed number of
 * places gives a quotient whose precision depends on the magnitudes involved:
 * `0.0125 ÷ 1609.344` came out with nine significant digits rather than
 * fourteen, and converting millimetres to miles and back lost eight of them.
 * The shift is therefore derived from the digit counts, and the result carries
 * the same precision wherever it sits on the number line.
 *
 * Returns `null` for division by zero — the caller renders doc 07 §3's inline
 * error rather than propagating an Infinity nothing else knows how to print.
 */
export function divide(a: TpDecimal, b: TpDecimal): TpDecimal | null {
	if (b.v === 0n) return null;
	if (a.v === 0n) return ZERO;

	const numerator = abs(a.v);
	const denominator = abs(b.v);

	// digits(n / d) ≈ digits(n) − digits(d); make up whatever that leaves short.
	const shift = Math.max(0, GUARD - (digitCount(numerator) - digitCount(denominator)));
	const scaled = numerator * pow10(shift);

	const quotient = scaled / denominator;
	const remainder = scaled % denominator;
	const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

	const negative = a.v < 0n !== b.v < 0n;
	// value = (a.v·10^shift / b.v) / 10^(shift + a.s − b.s).
	return roundSignificant({
		v: negative ? -rounded : rounded,
		s: shift + a.s - b.s
	});
}

/** Integer square root by Newton's method, to `MAX_SIGNIFICANT` digits.
 *  Negative input has no real root and returns null, which the caller shows as
 *  the same inline error as a division by zero. */
export function squareRoot(a: TpDecimal): TpDecimal | null {
	if (a.v < 0n) return null;
	if (a.v === 0n) return ZERO;

	// sqrt(v / 10^s) is sqrt(v · 10^k) / 10^((s+k)/2), which needs (s + k) even.
	// `k` is sized from the digit count for the same reason division is: the
	// root of an n-digit integer has about n/2 digits, so a fixed shift would
	// give a small input far fewer significant digits than a large one.
	const shift = (() => {
		const wanted = Math.max(0, 2 * GUARD - digitCount(a.v));
		return (a.s + wanted) % 2 === 0 ? wanted : wanted + 1;
	})();
	const scaled = a.v * pow10(shift);

	// The standard integer-sqrt loop: iterate while the estimate is still
	// falling, and keep the last one that fell. Newton on integers converges
	// and then oscillates between two neighbours, so a loop that exits *after*
	// taking the step returns the wrong side of that pair.
	let x = scaled;
	let next = (x + scaled / x) / 2n;
	while (next < x) {
		x = next;
		next = (x + scaled / x) / 2n;
	}

	return roundSignificant({ v: x, s: (a.s + shift) / 2 });
}

/** Parses the digits a user typed. Returns null for anything that is not a
 *  plain decimal — exponents and separators are display forms, not input. */
export function fromString(text: string): TpDecimal | null {
	const trimmed = text.trim();
	if (!/^-?\d*\.?\d*$/.test(trimmed) || /^-?\.?$/.test(trimmed)) return null;

	const negative = trimmed.startsWith('-');
	const body = negative ? trimmed.slice(1) : trimmed;
	const [whole = '', fraction = ''] = body.split('.');

	const digits = `${whole}${fraction}` || '0';
	const value = BigInt(digits);
	return normalise({ v: negative ? -value : value, s: fraction.length });
}

/** The exact value as a plain decimal string — no grouping, no exponent. This
 *  is the canonical form; locale formatting happens on top of it. */
export function toPlainString(d: TpDecimal): string {
	const value = normalise(d);
	if (value.v === 0n) return '0';

	const negative = value.v < 0n;
	let digits = abs(value.v).toString();

	if (value.s <= 0) {
		// Negative scale is trailing zeros the digits do not carry.
		digits += '0'.repeat(-value.s);
		return negative ? `-${digits}` : digits;
	}

	digits = digits.padStart(value.s + 1, '0');
	const whole = digits.slice(0, digits.length - value.s);
	const fraction = digits.slice(digits.length - value.s);
	return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * A JavaScript number, for the display layer only.
 *
 * Safe *because* of the cap above: twelve significant digits is well inside a
 * double's exact-integer range, so nothing is lost between the exact value and
 * the number `Intl.NumberFormat` groups and localises. The arithmetic never
 * touches this — that is the whole point of the file.
 */
export function toNumber(d: TpDecimal): number {
	return Number(toPlainString(d));
}
