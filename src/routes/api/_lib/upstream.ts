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
		readonly kind: 'timeout' | 'status' | 'too-large' | 'network',
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
		const timedOut = error instanceof Error && error.name === 'TimeoutError';
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
	const data = (options.parse === 'text' ? text : JSON.parse(text)) as T;
	return { data, headers: response.headers };
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
