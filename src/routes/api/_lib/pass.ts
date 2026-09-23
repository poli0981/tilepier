/**
 * The verification pass (doc 15 §3, doc 11 §9): what a browser carries on every
 * `/api/*` request once Turnstile has vouched for it.
 *
 * **Stateless.** Nothing is stored anywhere — not in KV, not in a cookie. A pass
 * is `v1.<exp>.<nonce>.<d>.<mac>`: an expiry in Unix seconds, 16 random bytes,
 * a degraded flag, and an HMAC-SHA256 over the first four fields. The Worker
 * can check one with a single `crypto.subtle.verify`, which is constant-time,
 * and nothing about the reader is in it — the nonce only makes two passes
 * issued in the same second differ.
 *
 * **Keyed off the Turnstile secret, through HKDF.** One secret to manage rather
 * than two, with the derivation's `info` keeping the two uses apart. Rotating
 * the Turnstile secret invalidates every pass, which is fine: the client
 * re-verifies on the next 401. Cloudflare holds that secret and so could mint
 * passes; it also runs the edge this Worker executes on.
 *
 * **Not bound to an address.** Phones change IP between towers and Wi-Fi, and a
 * pass that died with every hand-off would put a challenge in front of every
 * other tile refresh. The cost is that a pass lifted from one browser works
 * from another until it expires, which is why it lives an hour and why the
 * rate limiter and the budget guard still stand behind it.
 */

/** A normal pass. */
export const PASS_TTL_S = 3600;

/**
 * A pass issued while siteverify itself was unreachable (doc 15 §3). Short, so
 * an outage at Cloudflare's end degrades to "check again soon" rather than to
 * "the app is down" — and flagged, so a log line can tell the two apart.
 */
export const DEGRADED_PASS_TTL_S = 600;

/** Anything longer than this is not a pass, and is refused before any crypto. */
const MAX_PASS_LENGTH = 128;

/**
 * **Every segment has exactly one spelling.** Base64url of a length that is not
 * a multiple of three ends in a character carrying bits that encode nothing,
 * and `atob` discards them. So the final character of each encoded segment is
 * limited to the values with those bits clear:
 *
 * - the MAC is 32 bytes, 43 characters, two spare bits — `[AEIMQUYcgkosw048]`;
 * - the nonce is 16 bytes, 22 characters, four spare bits — `[AQgw]`.
 *
 * Until 2026-09-23 the MAC took any final character, which made every pass
 * valid under four spellings. Nothing more could be done with them than with
 * the pass itself, but a parse that accepts what `issuePass` never writes is not
 * the strict parse this module promises, and it would have become a real
 * problem the day anything keyed on the pass string. The nonce is never
 * decoded, so a second spelling of it already failed the MAC; it is held to the
 * same rule so that no segment needs that reasoning.
 */
const PASS =
	/^v1\.(\d{1,12})\.([A-Za-z0-9_-]{21}[AQgw])\.([01])\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/;

const keys = new Map<string, Promise<CryptoKey>>();

/** HKDF-SHA256 from the Turnstile secret, cached for the isolate's life. */
function passKey(secret: string): Promise<CryptoKey> {
	let key = keys.get(secret);
	if (key === undefined) {
		const encoder = new TextEncoder();
		key = crypto.subtle
			.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
			.then((base) =>
				crypto.subtle.deriveKey(
					{
						name: 'HKDF',
						hash: 'SHA-256',
						salt: encoder.encode('tilepier'),
						info: encoder.encode('pass/v1')
					},
					base,
					{ name: 'HMAC', hash: 'SHA-256', length: 256 },
					false,
					['sign', 'verify']
				)
			);
		keys.set(secret, key);
	}
	return key;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = '';
	for (const byte of view) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
	const padded = text.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export interface TpIssuedPass {
	pass: string;
	/** Unix ms, for the client to schedule its next check. */
	expiresAt: number;
}

export async function issuePass(
	secret: string,
	now: number,
	degraded = false
): Promise<TpIssuedPass> {
	const exp = Math.floor(now / 1000) + (degraded ? DEGRADED_PASS_TTL_S : PASS_TTL_S);
	const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
	const body = `v1.${String(exp)}.${nonce}.${degraded ? '1' : '0'}`;
	const mac = await crypto.subtle.sign(
		'HMAC',
		await passKey(secret),
		new TextEncoder().encode(body)
	);
	return { pass: `${body}.${base64url(mac)}`, expiresAt: exp * 1000 };
}

export async function verifyPass(secret: string, pass: string, now: number): Promise<boolean> {
	if (pass.length > MAX_PASS_LENGTH) return false;
	const match = PASS.exec(pass);
	if (match === null) return false;

	const exp = Number(match[1]);
	const nowS = Math.floor(now / 1000);
	// Expired, or further out than this build ever issues — the latter is a
	// forgery or a pass from a build with a longer TTL, and neither is ours.
	if (exp <= nowS || exp > nowS + PASS_TTL_S) return false;

	const body = pass.slice(0, pass.lastIndexOf('.'));
	return crypto.subtle.verify(
		'HMAC',
		await passKey(secret),
		fromBase64url(match[4] ?? ''),
		new TextEncoder().encode(body)
	);
}
