import { UPSTREAM } from '$lib/shared-constants';

/**
 * Guarded upstream fetch (doc 11 §8).
 *
 * Every external call from the Worker goes through here: 8 s timeout, 1 MB
 * cap, gzip accepted. The cap is checked twice — `content-length` when the
 * server bothers to send one, and again while reading, because a hostile or
 * broken upstream can simply omit it.
 */

export class UpstreamError extends Error {
	constructor(
		message: string,
		readonly kind: 'timeout' | 'status' | 'too-large' | 'network' | 'malformed',
		readonly status?: number,
		readonly headers?: Headers
	) {
		super(message);
		this.name = 'UpstreamError';
	}
}

export interface UpstreamResult<T> {
	data: T;
	headers: Headers;
}

/**
 * What a thrown value from `fetch` or from reading its body means here.
 *
 * `AbortSignal.timeout()` rejects with TimeoutError per spec, but an aborted
 * request surfaces as AbortError on some runtimes. They mean the same thing
 * here and the breaker counts them differently from a network failure, so both
 * map to `'timeout'`.
 *
 * **The body is covered too** (Week 6). The signal keeps running after the
 * headers arrive, so a slow body is cut by the same deadline — and until then
 * that surfaced as a raw DOMException, because only the `fetch()` call sat
 * inside this classification.
 */
export function toUpstreamError(error: unknown): UpstreamError {
	if (error instanceof UpstreamError) return error;
	const name = error instanceof Error ? error.name : '';
	const timedOut = name === 'TimeoutError' || name === 'AbortError';
	return new UpstreamError(
		timedOut ? `timeout after ${UPSTREAM.timeoutMs}ms` : String(error),
		timedOut ? 'timeout' : 'network'
	);
}

export async function fetchUpstream<T>(
	url: string,
	options: { headers?: Record<string, string>; parse?: 'json' | 'text' } = {}
): Promise<UpstreamResult<T>> {
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { 'accept-encoding': 'gzip', ...options.headers },
			signal: AbortSignal.timeout(UPSTREAM.timeoutMs)
		});
	} catch (error) {
		throw toUpstreamError(error);
	}

	if (!response.ok) {
		throw new UpstreamError(
			`upstream ${response.status}${await statusSnippet(response)}`,
			'status',
			response.status,
			response.headers
		);
	}

	const declared = Number(response.headers.get('content-length') ?? '0');
	if (declared > UPSTREAM.maxResponseBytes) {
		throw new UpstreamError(
			`content-length ${declared} over cap`,
			'too-large',
			200,
			response.headers
		);
	}

	let text: string;
	try {
		text = await readCapped(response);
	} catch (error) {
		throw toUpstreamError(error);
	}
	if (options.parse === 'text') return { data: text as T, headers: response.headers };

	try {
		return { data: JSON.parse(text) as T, headers: response.headers };
	} catch {
		// doc 17 §4: malformed JSON is treated as the upstream being down, and
		// logged with a body snippet. A raw SyntaxError was already caught by the
		// endpoint's outer handler, so this is not a crash being fixed — what it
		// buys is the snippet, which is the only thing that says *which* upstream
		// returned an HTML error page, and a `kind` a caller can branch on
		// instead of string-matching an exception message.
		throw new UpstreamError(
			`malformed JSON: ${text.slice(0, 1024)}`,
			'malformed',
			response.status,
			response.headers
		);
	}
}

/** How much of an error body rides along in the message. */
const STATUS_SNIPPET = 160;

/**
 * The start of a non-2xx body, flattened to one line, for the breaker's
 * `reason` — which is what `/api/_health` prints (doc 11 §9).
 *
 * A bare `upstream 451` says a request was refused; the body usually says why,
 * and "why" is the question: 5a's Binance failure alternated 400/503 on
 * production for a week with nothing that could tell a regional block from a
 * malformed request. Best-effort and bounded: a body that will not read, or
 * runs past the cap, simply contributes nothing.
 */
async function statusSnippet(response: Response): Promise<string> {
	try {
		const text = (await readCapped(response)).replace(/\s+/g, ' ').trim();
		return text === '' ? '' : `: ${text.slice(0, STATUS_SNIPPET)}`;
	} catch {
		return '';
	}
}

/** Reads the body as UTF-8, aborting past the cap rather than buffering it all
 *  first. */
async function readCapped(response: Response): Promise<string> {
	return new TextDecoder().decode(await readCappedBytes(response));
}

/**
 * Reads the body as bytes, aborting past the cap rather than buffering it all
 * first.
 *
 * Bytes rather than text for `/api/rss`, whose documents declare their own
 * encoding in a place only the bytes can show — an XML declaration, a BOM
 * (doc 10 §7). Everything else here is JSON, which is UTF-8 by definition.
 * Throws the raw error of a failed read; callers classify it with
 * `toUpstreamError`.
 */
export async function readCappedBytes(response: Response): Promise<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array(await response.arrayBuffer());

	const chunks: Uint8Array[] = [];
	let size = 0;

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > UPSTREAM.maxResponseBytes) {
			await reader.cancel();
			throw new UpstreamError(`body exceeded ${UPSTREAM.maxResponseBytes} bytes`, 'too-large');
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
