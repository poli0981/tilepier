import type { TpApiMeta, TpApiResponse } from '$lib/api-types';

/**
 * The client half of the doc 11 §2 envelope: one place that knows how to call
 * `/api/*` and what its failures mean (doc 17 §4).
 *
 * Deliberately free of runes, of Dexie and of the network *policy* —
 * `swr.svelte.ts` owns caching, de-duplication and status, and calls this. The
 * split is what lets this half be tested in the node project against MSW while
 * the other half is tested in the browser with plain stub fetchers, and neither
 * has to fake the thing the other one owns.
 */

/** doc 04 §2. */
export type TpApiErrorCode =
	'NETWORK' | 'RATE_LIMITED' | 'QUOTA_EXHAUSTED' | 'UPSTREAM_DOWN' | 'BAD_REQUEST' | 'MALFORMED';

export class TpApiError extends Error {
	readonly code: TpApiErrorCode;
	/** From the envelope or the `retry-after` header, when the server named one. */
	readonly retryAfterS: number | undefined;
	/** Up to 1 KB of the body, for `MALFORMED` only (doc 17 §4). */
	readonly snippet: string | undefined;

	constructor(
		code: TpApiErrorCode,
		message: string,
		options: { retryAfterS?: number; snippet?: string } = {}
	) {
		super(message);
		this.name = 'TpApiError';
		this.code = code;
		this.retryAfterS = options.retryAfterS;
		this.snippet = options.snippet;
	}
}

/**
 * Whether a failure is worth trying again.
 *
 * `BAD_REQUEST` is the only permanent one: it means this build asked for
 * something the endpoint does not accept, so the same request will fail the
 * same way forever and retrying it only spends quota. Everything else is a
 * condition that passes.
 *
 * **`MALFORMED` is retryable, and doc 04 §2 said otherwise.** That section
 * grouped it with `BAD_REQUEST` as "log loudly, never retried" while doc 17 §4
 * said "treat as `UPSTREAM_DOWN`" — the two could not both hold. Resolved here
 * in doc 17 §4's favour, because the realistic cause of a malformed body is an
 * HTML error page from the edge rather than a request we got wrong, and that
 * clears on its own. The code stays distinct so diagnostics can tell the two
 * apart; only the retry decision is shared. doc 04 §2 amended 2026-08-28.
 */
export function isRetryable(code: TpApiErrorCode): boolean {
	return code !== 'BAD_REQUEST';
}

/** The 1 KB doc 17 §4 asks for, so a log line names which upstream returned
 *  HTML without pasting the whole page into the ring buffer. */
const SNIPPET_MAX = 1024;

export interface TpApiResult<T> {
	data: T;
	meta: TpApiMeta;
}

/**
 * `GET` an `/api/*` endpoint and unwrap the envelope, or throw a `TpApiError`.
 *
 * Every failure mode of doc 17 §4 arrives here as one of six codes, so a caller
 * never has to look at a status number or parse a body twice.
 */
export async function fetchEnvelope<T>(url: string, signal?: AbortSignal): Promise<TpApiResult<T>> {
	let response: Response;
	try {
		response = await fetch(url, {
			...(signal === undefined ? {} : { signal }),
			headers: { accept: 'application/json' }
		});
	} catch (error) {
		// doc 17 §4: a `TypeError` from fetch is the offline path. An abort is
		// not a network failure — the caller asked for it — and is re-thrown
		// unchanged so `swr` can tell the two apart.
		if (error instanceof Error && error.name === 'AbortError') throw error;
		throw new TpApiError('NETWORK', error instanceof Error ? error.message : String(error));
	}

	const text = await response.text();

	let body: TpApiResponse<T>;
	try {
		body = JSON.parse(text) as TpApiResponse<T>;
	} catch {
		throw new TpApiError('MALFORMED', `not JSON (HTTP ${String(response.status)})`, {
			snippet: text.slice(0, SNIPPET_MAX)
		});
	}

	if (body.ok === true) return { data: body.data, meta: body.meta };

	// An `ok: false` body carries the code; the header is the fallback for a
	// 429 that reached us from the zone rule rather than from the Worker, which
	// has no envelope at all (doc 11 §7).
	const header = Number(response.headers.get('retry-after'));
	const retryAfterS = body.error?.retryAfterS ?? (Number.isFinite(header) ? header : undefined);
	const code = body.error?.code;

	if (code === undefined) {
		throw new TpApiError('MALFORMED', 'envelope had no error code', {
			snippet: text.slice(0, SNIPPET_MAX)
		});
	}

	throw new TpApiError(code, `${code} (HTTP ${String(response.status)})`, {
		...(retryAfterS === undefined ? {} : { retryAfterS })
	});
}
