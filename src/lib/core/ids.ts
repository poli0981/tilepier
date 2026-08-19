/**
 * Instance ids (doc 05 §2).
 *
 * nanoid is not a dependency and is not being added: it is absent from doc 02's
 * locked stack, and the platform already ships the only primitive that matters.
 */

/**
 * Crockford-ish — no vowels, so no accidental words, and none of the
 * digit-lookalikes. Exactly 32 characters, which is the load-bearing part:
 * `256 % 32 === 0`, so `byte % 32` is a uniform draw. The obvious 62-character
 * alphabet is biased toward its first 8 characters, and nothing about the
 * output looks wrong when that happens.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

const ID_LENGTH = 8;

/** `wgt_` + 8 characters ≈ 40 bits. A deck holds tens of tiles, not millions. */
export function newInstanceId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
	let out = '';
	// charAt rather than indexing: noUncheckedIndexedAccess types [] as
	// possibly undefined, and a modulo into a fixed alphabet never is.
	for (const byte of bytes) out += ALPHABET.charAt(byte % ALPHABET.length);
	return `wgt_${out}`;
}
