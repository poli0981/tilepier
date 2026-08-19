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
		// AbortSignal.timeout() rejects with TimeoutError per spec, but an
		// aborted request surfaces as AbortError on some runtimes. They mean the
		// same thing here and the breaker counts them differently from a network
		// failure, so both map to 'timeout'.
		const name = error instanceof Error ? error.name : '';
		const timedOut = name === 'TimeoutError' || name === 'AbortError';
		throw new UpstreamError(
			timedOut ? `timeout after ${UPSTREAM.timeoutMs}ms` : String(error),
			timedOut ? 'timeout' : 'network'
		);
	}

	if (!response.ok) {
		throw new UpstreamError(
			`upstream ${response.status}`,
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

	const text = await readCapped(response);
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

/** Reads the body, aborting past the cap rather than buffering it all first. */
async function readCapped(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return response.text();

	const decoder = new TextDecoder();
	let size = 0;
	let text = '';

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > UPSTREAM.maxResponseBytes) {
			await reader.cancel();
			throw new UpstreamError(`body exceeded ${UPSTREAM.maxResponseBytes} bytes`, 'too-large');
		}
		text += decoder.decode(value, { stream: true });
	}

	return text + decoder.decode();
}
