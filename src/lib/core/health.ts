import type { TpApiResponse, TpHealthReport } from '$lib/api-types';

/**
 * The diagnostics panel's read of `GET /api/_health` (doc 13 §10, doc 11 §9).
 *
 * **The token is a parameter and nothing else.** It comes from a password
 * field, rides in one `Authorization` header, and goes when the panel does —
 * not into `tp.settings.v1` (the three-key rule, and the wrong place for a
 * secret), not into the URL (invocation logs, history, and the analytics
 * beacon's page), and never into `logEntry`, because a bug report exports the
 * ring buffer.
 *
 * Deliberately not `fetchEnvelope`: that is the widgets' transport, with their
 * retry and error vocabulary, and this is one operator asking one question.
 */

export type TpHealthResult =
	| { kind: 'ok'; report: TpHealthReport }
	/** A 404: the token is wrong, or this deploy has no token set at all. */
	| { kind: 'refused' }
	/** Offline, a 5xx, or a body that is not the envelope. */
	| { kind: 'failed' };

export async function fetchHealth(
	token: string,
	fetcher: typeof fetch = fetch
): Promise<TpHealthResult> {
	let response: Response;
	try {
		response = await fetcher('/api/_health', {
			headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
			cache: 'no-store'
		});
	} catch {
		return { kind: 'failed' };
	}

	if (response.status === 404) return { kind: 'refused' };

	try {
		const body = (await response.json()) as TpApiResponse<TpHealthReport>;
		return body.ok ? { kind: 'ok', report: body.data } : { kind: 'failed' };
	} catch {
		return { kind: 'failed' };
	}
}
