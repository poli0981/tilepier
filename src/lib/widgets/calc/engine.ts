import {
	ZERO,
	add,
	divide,
	fromString,
	isZero,
	multiply,
	negate,
	roundSignificant,
	squareRoot,
	subtract,
	toNumber,
	type TpDecimal
} from './decimal';

/**
 * doc 07 §3: shunting-yard over the exact decimals in `decimal.ts`.
 *
 * **No `eval`, and not because of taste.** CSP is `script-src 'self'` with no
 * `'unsafe-inline'` (doc 15 §2), so `eval` on a user-supplied string is
 * blocked by the browser before it is a security question — and it would give
 * float arithmetic, which doc 07 §3 rules out separately.
 */

export type TpCalcError = 'SYNTAX' | 'DIVIDE_BY_ZERO' | 'DOMAIN';

export type TpCalcResult = { ok: true; value: TpDecimal } | { ok: false; error: TpCalcError };

type Operator = '+' | '-' | '*' | '/';

type Token =
	| { kind: 'num'; value: TpDecimal }
	| { kind: 'op'; op: Operator }
	/** Prefix minus. A separate token from subtraction because they bind
	 *  differently: `2 * -3` parses, `2 * - 3` as subtraction does not. */
	| { kind: 'neg' }
	/** Postfix `%` — divide by a hundred. doc 07 §3 lists it in the scientific
	 *  row, so it acts on the value in front of it rather than pretending to
	 *  know what `50 + 10%` was supposed to mean. */
	| { kind: 'pct' }
	| { kind: 'lparen' }
	| { kind: 'rparen' };

/** Only these three ever reach the operator stack. Naming that subset is what
 *  lets `top.op` narrow — against the full `Token` union TypeScript is right to
 *  refuse, because a number could not be there but the type said it could. */
type StackToken = Extract<Token, { kind: 'op' }> | { kind: 'neg' } | { kind: 'lparen' };

const PRECEDENCE: Record<Operator, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
/** Above `*`, so `-2 * 3` negates the 2 and not the product. */
const UNARY_PRECEDENCE = 3;

/** Both spellings of every character a calculator keypad or a keyboard emits.
 *  `×` and `÷` come from the on-screen buttons, `*` and `/` from the keyboard,
 *  and `,` is a decimal separator on a Vietnamese layout. */
function canonicalise(input: string): string {
	return input.replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-').replaceAll(',', '.');
}

function tokenize(input: string): Token[] | null {
	const source = canonicalise(input);
	const tokens: Token[] = [];
	let index = 0;

	/** True when the previous token was a value, which is what tells a minus
	 *  sign whether it is subtraction or a negation. */
	let afterValue = false;

	while (index < source.length) {
		const char = source[index] ?? '';

		if (/\s/.test(char)) {
			index += 1;
			continue;
		}

		if (/[\d.]/.test(char)) {
			let end = index;
			while (end < source.length && /[\d.]/.test(source[end] ?? '')) end += 1;
			const value = fromString(source.slice(index, end));
			if (value === null) return null;
			tokens.push({ kind: 'num', value });
			index = end;
			afterValue = true;
			continue;
		}

		if (char === '(') {
			tokens.push({ kind: 'lparen' });
			index += 1;
			afterValue = false;
			continue;
		}

		if (char === ')') {
			tokens.push({ kind: 'rparen' });
			index += 1;
			afterValue = true;
			continue;
		}

		if (char === '%') {
			if (!afterValue) return null;
			tokens.push({ kind: 'pct' });
			index += 1;
			continue;
		}

		if (char === '+' || char === '-' || char === '*' || char === '/') {
			if (char === '-' && !afterValue) tokens.push({ kind: 'neg' });
			else if (!afterValue) return null;
			else tokens.push({ kind: 'op', op: char });
			index += 1;
			afterValue = false;
			continue;
		}

		return null;
	}

	return tokens;
}

/** Shunting-yard: infix tokens in, reverse-Polish out. */
function toPostfix(tokens: readonly Token[]): Token[] | null {
	const output: Token[] = [];
	const stack: StackToken[] = [];

	for (const token of tokens) {
		if (token.kind === 'num') {
			output.push(token);
			continue;
		}

		// Postfix already — it binds tighter than anything and needs no stack.
		if (token.kind === 'pct') {
			output.push(token);
			continue;
		}

		if (token.kind === 'neg') {
			stack.push(token);
			continue;
		}

		if (token.kind === 'op') {
			while (stack.length > 0) {
				const top = stack[stack.length - 1];
				if (top === undefined || top.kind === 'lparen') break;

				const topPrecedence = top.kind === 'neg' ? UNARY_PRECEDENCE : PRECEDENCE[top.op];
				// Left-associative: an equal precedence on the stack goes first, so
				// `8 / 4 / 2` is 1 and not 4.
				if (topPrecedence < PRECEDENCE[token.op]) break;
				output.push(stack.pop() as StackToken);
			}
			stack.push(token);
			continue;
		}

		if (token.kind === 'lparen') {
			stack.push(token);
			continue;
		}

		// rparen
		let matched = false;
		while (stack.length > 0) {
			const top = stack.pop() as StackToken;
			if (top.kind === 'lparen') {
				matched = true;
				break;
			}
			output.push(top);
		}
		if (!matched) return null;
	}

	while (stack.length > 0) {
		const top = stack.pop() as StackToken;
		if (top.kind === 'lparen') return null;
		output.push(top);
	}

	return output;
}

const HUNDRED: TpDecimal = { v: 100n, s: 0 };

function evaluatePostfix(tokens: readonly Token[]): TpCalcResult {
	const stack: TpDecimal[] = [];

	for (const token of tokens) {
		if (token.kind === 'num') {
			stack.push(token.value);
			continue;
		}

		if (token.kind === 'pct') {
			const operand = stack.pop();
			if (operand === undefined) return { ok: false, error: 'SYNTAX' };
			const value = divide(operand, HUNDRED);
			if (value === null) return { ok: false, error: 'DIVIDE_BY_ZERO' };
			stack.push(value);
			continue;
		}

		if (token.kind === 'neg') {
			const operand = stack.pop();
			if (operand === undefined) return { ok: false, error: 'SYNTAX' };
			stack.push(negate(operand));
			continue;
		}

		if (token.kind !== 'op') return { ok: false, error: 'SYNTAX' };

		const right = stack.pop();
		const left = stack.pop();
		if (left === undefined || right === undefined) return { ok: false, error: 'SYNTAX' };

		if (token.op === '+') stack.push(add(left, right));
		else if (token.op === '-') stack.push(subtract(left, right));
		else if (token.op === '*') stack.push(multiply(left, right));
		else {
			// doc 07 §3: divide-by-zero is an inline error state, not an Infinity
			// passed downstream for something else to fail to print.
			const value = divide(left, right);
			if (value === null) return { ok: false, error: 'DIVIDE_BY_ZERO' };
			stack.push(value);
		}
	}

	const result = stack.pop();
	if (result === undefined || stack.length > 0) return { ok: false, error: 'SYNTAX' };
	return { ok: true, value: result };
}

export function evaluate(expression: string): TpCalcResult {
	if (expression.trim() === '') return { ok: true, value: ZERO };

	const tokens = tokenize(expression);
	if (tokens === null) return { ok: false, error: 'SYNTAX' };

	const postfix = toPostfix(tokens);
	if (postfix === null) return { ok: false, error: 'SYNTAX' };

	return evaluatePostfix(postfix);
}

/** The scientific row (doc 07 §3). These act on the value already on the
 *  display rather than on the expression, which is what the buttons mean. */
export type TpCalcUnary = 'sqrt' | 'square' | 'reciprocal' | 'negate' | 'percent';

export function applyUnary(value: TpDecimal, operation: TpCalcUnary): TpCalcResult {
	if (operation === 'negate') return { ok: true, value: negate(value) };
	if (operation === 'square') return { ok: true, value: multiply(value, value) };

	if (operation === 'percent') {
		const result = divide(value, HUNDRED);
		return result === null ? { ok: false, error: 'DIVIDE_BY_ZERO' } : { ok: true, value: result };
	}

	if (operation === 'reciprocal') {
		if (isZero(value)) return { ok: false, error: 'DIVIDE_BY_ZERO' };
		const result = divide({ v: 1n, s: 0 }, value);
		return result === null ? { ok: false, error: 'DIVIDE_BY_ZERO' } : { ok: true, value: result };
	}

	const root = squareRoot(value);
	// The square root of a negative number is not an error in the arithmetic —
	// it is outside the domain, and says so distinctly.
	return root === null ? { ok: false, error: 'DOMAIN' } : { ok: true, value: root };
}

/**
 * Past this, a plain rendering is a wall of digits nobody reads, so doc 07 §3's
 * "overflow → exponent display" takes over. Below the small threshold the same
 * is true from the other end: `0.000000000123` is worse than `1.23e-10`.
 */
const EXPONENT_ABOVE = 1e15;
const EXPONENT_BELOW = 1e-9;

/**
 * doc 07 §3's "result line shows thousands separators per locale", through
 * `Intl.NumberFormat` rather than a hand-rolled regex (doc 14 §3).
 *
 * The hop through `Number` is safe here *because* of the twelve-digit cap: at
 * that width every value is exactly representable as a double, so nothing is
 * lost between the exact decimal and the string a user reads. The arithmetic
 * never takes this path.
 */
export function formatValue(value: TpDecimal, locale: string): string {
	const rounded = roundSignificant(value);
	const asNumber = toNumber(rounded);
	const magnitude = Math.abs(asNumber);

	if (magnitude >= EXPONENT_ABOVE || (asNumber !== 0 && magnitude < EXPONENT_BELOW)) {
		return new Intl.NumberFormat(locale, {
			notation: 'scientific',
			maximumFractionDigits: 6
		}).format(asNumber);
	}

	return new Intl.NumberFormat(locale, { maximumFractionDigits: 12 }).format(asNumber);
}
