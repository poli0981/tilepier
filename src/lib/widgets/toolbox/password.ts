/**
 * Password generation for doc 07 §7's second tab.
 *
 * Two rules that section states and this module exists to keep: the draw comes
 * from `crypto.getRandomValues` with **rejection sampling**, so there is no
 * modulo bias, and a generated value is never stored anywhere — not in
 * settings, not in Dexie, not in the ring buffer.
 *
 * The bias matters more than it looks. `bytes[i] % alphabet.length` is uniform
 * only when the length divides 256; for a 70-character set the first sixteen
 * characters come up about 1.4 times as often as the rest, and nothing about
 * the output looks wrong when that happens. `core/ids.ts` avoids the same trap
 * by choosing a 32-character alphabet; here the alphabet is the user's, so the
 * sampling has to do the work instead.
 */

export interface TpPasswordOptions {
	length: number;
	lower: boolean;
	upper: boolean;
	digits: boolean;
	symbols: boolean;
	/** doc 07 §7: drop the characters that are read wrong out loud or on paper. */
	noAmbiguous: boolean;
}

export const PASSWORD_LIMITS = { min: 8, max: 64 } as const;

export const PASSWORD_DEFAULTS: TpPasswordOptions = {
	length: 20,
	lower: true,
	upper: true,
	digits: true,
	symbols: true,
	noAmbiguous: false
};

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
/** Punctuation a shell, a CSV and a URL all survive. No quotes, no backslash. */
const SYMBOLS = '!#$%&()*+,-.:;<=>?@[]^_{|}~';

/** `l`/`I`/`1`, `O`/`0`, and the brackets that look alike in a narrow font. */
const AMBIGUOUS = new Set([...'lI1O0oB8S5Z2G6|[]{}']);

export function alphabetFor(options: TpPasswordOptions): string {
	let alphabet = '';
	if (options.lower) alphabet += LOWER;
	if (options.upper) alphabet += UPPER;
	if (options.digits) alphabet += DIGITS;
	if (options.symbols) alphabet += SYMBOLS;

	if (!options.noAmbiguous) return alphabet;
	return [...alphabet].filter((character) => !AMBIGUOUS.has(character)).join('');
}

/**
 * Shannon entropy of the *generator*, in bits — `length × log2(alphabet)`.
 *
 * A property of the settings, not of the string that came out: the string is
 * one draw and has no entropy of its own. That is why this takes options
 * rather than a password, and why the readout can be shown before anything is
 * generated.
 */
export function entropyBits(options: TpPasswordOptions): number {
	const alphabet = alphabetFor(options);
	if (alphabet.length < 2) return 0;
	return Math.round(clampLength(options.length) * Math.log2(alphabet.length));
}

export function clampLength(length: number): number {
	if (!Number.isFinite(length)) return PASSWORD_DEFAULTS.length;
	return Math.min(PASSWORD_LIMITS.max, Math.max(PASSWORD_LIMITS.min, Math.round(length)));
}

/**
 * `''` when every character class is switched off — there is nothing to draw
 * from, and a silent fallback to lowercase would hand back a weaker password
 * than the settings on screen claim.
 */
export function generatePassword(options: TpPasswordOptions): string {
	const alphabet = alphabetFor(options);
	if (alphabet.length === 0) return '';

	const length = clampLength(options.length);
	// Rejection sampling: the largest multiple of the alphabet length that fits
	// in a byte, with everything above it thrown away and redrawn. A `% n` over
	// the whole range is what biases toward the first `256 % n` characters.
	const limit = Math.floor(256 / alphabet.length) * alphabet.length;

	let out = '';
	// Drawn in blocks rather than one byte at a time, so a 64-character password
	// is a couple of calls into the CSPRNG instead of ninety.
	const block = new Uint8Array(length * 2);

	while (out.length < length) {
		crypto.getRandomValues(block);
		for (const byte of block) {
			if (byte >= limit) continue;
			out += alphabet.charAt(byte % alphabet.length);
			if (out.length === length) break;
		}
	}

	return out;
}
