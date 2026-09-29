/**
 * SHA-256 as lowercase hex, cut to its first `bytes` bytes — the one copy the
 * client keeps (Week 7b; doc 05 §4).
 *
 * Music's track ids and cover keys are the first twelve bytes, and media's
 * resume keys will be too. **They are stored**, in `tracks`, `trackBlobs`,
 * `playlists` and `playback`, so what this returns for a given input must never
 * change: a golden test pins it against Node's own hash.
 *
 * Two copies stay apart on purpose. `feedUrlHash` in shared-constants is shared
 * with the Worker, whose KV keys it names; the rate limiter's `hashIp` is
 * server-only and salted.
 *
 * `crypto.subtle` exists only in a secure context. On plain http it is
 * missing, and a caller that can do without a hash should.
 */
export async function sha256Hex(input: string | Uint8Array, bytes = 32): Promise<string> {
	// A copy, so a view on a larger or shared buffer hashes only its own bytes.
	const data = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(digest)]
		.slice(0, bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}
