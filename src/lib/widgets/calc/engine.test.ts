import { describe, expect, it } from 'vitest';
import { fromString, toPlainString, type TpDecimal } from './decimal';
import { applyUnary, evaluate, formatValue } from './engine';

/**
 * doc 19 §3.2 names this one of the non-negotiable suites: "operator
 * precedence, affine temperature, 12-digit rounding, divide-by-zero, locale
 * formatting". Temperature is in `convert.test.ts`; the other four are here.
 */

/** Asserts on the exact decimal string, not on a float — comparing a
 *  calculator's output with `toBeCloseTo` would defeat the point of the whole
 *  module. */
function result(expression: string): string {
	const outcome = evaluate(expression);
	if (!outcome.ok) throw new Error(`expected a value, got ${outcome.error}`);
	return toPlainString(outcome.value);
}

function error(expression: string): string {
	const outcome = evaluate(expression);
	if (outcome.ok) throw new Error(`expected an error, got ${toPlainString(outcome.value)}`);
	return outcome.error;
}

function dec(text: string): TpDecimal {
	const value = fromString(text);
	if (value === null) throw new Error(`"${text}" is not a decimal`);
	return value;
}

describe('exactness', () => {
	it('adds the number every float gets wrong', () => {
		// The reason this module exists instead of a `+`.
		expect(result('0.1 + 0.2')).toBe('0.3');
	});

	it('keeps money exact across a long chain', () => {
		expect(result('0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1 + 0.1')).toBe('1');
		expect(result('1.1 * 3')).toBe('3.3');
		expect(result('4.35 * 100')).toBe('435');
	});

	it('subtracts without leaving a residue', () => {
		expect(result('1 - 0.9')).toBe('0.1');
		expect(result('0.3 - 0.1')).toBe('0.2');
	});
});

describe('operator precedence', () => {
	it('multiplies before it adds', () => {
		expect(result('2 + 3 * 4')).toBe('14');
		expect(result('2 * 3 + 4')).toBe('10');
	});

	it('obeys parentheses', () => {
		expect(result('(2 + 3) * 4')).toBe('20');
		expect(result('2 * (3 + 4)')).toBe('14');
		expect(result('((2))')).toBe('2');
	});

	it('associates left to right at equal precedence', () => {
		// 8 / 4 / 2 is 1, not 4 — the classic way to get this wrong.
		expect(result('8 / 4 / 2')).toBe('1');
		expect(result('10 - 3 - 2')).toBe('5');
	});

	it('binds a leading minus to the number, not to the product', () => {
		expect(result('-2 * 3')).toBe('-6');
		expect(result('2 * -3')).toBe('-6');
		expect(result('-2 + 3')).toBe('1');
		expect(result('-(2 + 3)')).toBe('-5');
	});

	it('reads a percent as a hundredth of what precedes it', () => {
		expect(result('50%')).toBe('0.5');
		expect(result('200 * 15%')).toBe('30');
	});
});

describe('twelve significant digits', () => {
	it('rounds a repeating decimal rather than truncating it', () => {
		// 0.666… rounds up at the twelfth digit; a truncating divide would end
		// in 6 and be wrong.
		expect(result('2 / 3')).toBe('0.666666666667');
		expect(result('1 / 3')).toBe('0.333333333333');
	});

	it('caps a long result at twelve digits', () => {
		expect(result('1 / 7').replace('0.', '')).toHaveLength(12);
	});

	it('keeps a short result exact', () => {
		expect(result('1 / 8')).toBe('0.125');
		expect(result('1 / 4')).toBe('0.25');
	});

	it('rounds half away from zero, in both directions', () => {
		// Thirteen significant digits in, twelve out, and the dropped digit is
		// exactly a five — so it goes *up* in both directions rather than to the
		// nearest even, which is right for a calculator and wrong for a ledger.
		expect(result('1.000000000005 * 1')).toBe('1.00000000001');
		expect(result('-1.000000000005 * 1')).toBe('-1.00000000001');
	});

	it('rounds down when the dropped digits do not reach half', () => {
		// Fourteen digits in: "05" is dropped, and five hundredths of the last
		// kept digit is not half of it.
		expect(result('1.0000000000005 * 1')).toBe('1');
	});
});

describe('divide by zero', () => {
	it('is an error, not an Infinity', () => {
		// doc 07 §3: an inline error state. Nothing downstream has to know how to
		// print Infinity.
		expect(error('1 / 0')).toBe('DIVIDE_BY_ZERO');
		expect(error('0 / 0')).toBe('DIVIDE_BY_ZERO');
		expect(error('5 / (3 - 3)')).toBe('DIVIDE_BY_ZERO');
	});
});

describe('syntax', () => {
	it('rejects an incomplete expression', () => {
		expect(error('2 +')).toBe('SYNTAX');
		expect(error('* 2')).toBe('SYNTAX');
		expect(error('2 2')).toBe('SYNTAX');
	});

	it('rejects unbalanced parentheses in either direction', () => {
		expect(error('(2 + 3')).toBe('SYNTAX');
		expect(error('2 + 3)')).toBe('SYNTAX');
	});

	it('rejects what is not a number', () => {
		expect(error('abc')).toBe('SYNTAX');
		expect(error('2 .. 3')).toBe('SYNTAX');
		expect(error('2 & 3')).toBe('SYNTAX');
	});

	it('treats an empty expression as zero rather than as a mistake', () => {
		// The display starts empty; that is not an error to show the user.
		expect(result('')).toBe('0');
		expect(result('   ')).toBe('0');
	});

	it('accepts the symbols the on-screen keypad emits', () => {
		// × ÷ − come from the buttons, * / - from the keyboard, and a comma is a
		// decimal separator on a Vietnamese layout.
		expect(result('6 × 7')).toBe('42');
		expect(result('84 ÷ 2')).toBe('42');
		expect(result('50 − 8')).toBe('42');
		expect(result('0,5 + 0,5')).toBe('1');
	});
});

describe('the scientific row', () => {
	it('takes a square root, exactly where it can', () => {
		expect(toPlainString(unary('9', 'sqrt'))).toBe('3');
		expect(toPlainString(unary('2.25', 'sqrt'))).toBe('1.5');
		expect(toPlainString(unary('0', 'sqrt'))).toBe('0');
	});

	it('takes an irrational root to twelve digits', () => {
		expect(toPlainString(unary('2', 'sqrt'))).toBe('1.41421356237');
	});

	it('refuses the root of a negative number as out of domain', () => {
		// A distinct error from dividing by zero: the arithmetic is fine, the
		// input is not.
		const outcome = applyUnary(dec('-1'), 'sqrt');
		expect(outcome.ok ? 'ok' : outcome.error).toBe('DOMAIN');
	});

	it('squares, negates and reciprocates', () => {
		expect(toPlainString(unary('1.5', 'square'))).toBe('2.25');
		expect(toPlainString(unary('-3', 'negate'))).toBe('3');
		expect(toPlainString(unary('4', 'reciprocal'))).toBe('0.25');
		expect(toPlainString(unary('50', 'percent'))).toBe('0.5');
	});

	it('refuses the reciprocal of zero', () => {
		const outcome = applyUnary(dec('0'), 'reciprocal');
		expect(outcome.ok ? 'ok' : outcome.error).toBe('DIVIDE_BY_ZERO');
	});
});

function unary(text: string, operation: Parameters<typeof applyUnary>[1]): TpDecimal {
	const outcome = applyUnary(dec(text), operation);
	if (!outcome.ok) throw new Error(`expected a value, got ${outcome.error}`);
	return outcome.value;
}

describe('locale formatting', () => {
	it('groups thousands the way the locale does', () => {
		// doc 07 §3: "result line shows thousands separators per locale".
		expect(formatValue(dec('1234567'), 'en-GB')).toBe('1,234,567');
		expect(formatValue(dec('1234567'), 'de-DE')).toBe('1.234.567');
		expect(formatValue(dec('1234567'), 'vi-VN')).toBe('1.234.567');
	});

	it('uses the locale decimal separator', () => {
		expect(formatValue(dec('1.5'), 'en-GB')).toBe('1.5');
		expect(formatValue(dec('1.5'), 'vi-VN')).toBe('1,5');
	});

	it('keeps twelve digits through the formatter', () => {
		expect(formatValue(dec('0.333333333333'), 'en-GB')).toBe('0.333333333333');
	});

	it('switches to an exponent when a plain rendering stops being readable', () => {
		// doc 07 §3: "overflow → exponent display", from both ends.
		expect(formatValue(dec('1000000000000000000'), 'en-GB')).toMatch(/E18$/);
		expect(formatValue(dec('0.0000000001'), 'en-GB')).toMatch(/E-10$/);
	});

	it('leaves an ordinary number alone', () => {
		expect(formatValue(dec('0'), 'en-GB')).toBe('0');
		expect(formatValue(dec('-42.5'), 'en-GB')).toBe('-42.5');
	});
});
