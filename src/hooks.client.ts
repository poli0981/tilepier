import type { ClientInit, HandleClientError } from '@sveltejs/kit';
import { installLogBuffer, logEntry } from '$lib/core/log-buffer';
import { settings } from '$lib/stores/settings.svelte';

/**
 * Client-side counterpart to hooks.server.ts.
 *
 * `init` is awaited by SvelteKit before hydration, which is the ordering
 * guarantee the rest of the app leans on: anything registered here is in place
 * before the first component renders.
 */

/** Best-effort browser name for the doc 18 §2 environment block. */
function uaBrand(): string {
	const data = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } })
		.userAgentData;
	const brand = data?.brands?.find((b) => !/not.a.brand/i.test(b.brand))?.brand;
	return brand ?? navigator.userAgent.slice(0, 80);
}

export const init: ClientInit = () => {
	settings.hydrate();
	installLogBuffer({
		version: __TP_BUILD__.version,
		sha: __TP_BUILD__.sha,
		uaBrand: uaBrand(),
		locale: settings.locale
	});
};

/**
 * doc 17 §1: normalise to an id plus a generic message, log the detail, and put
 * the id on the 500 page so a bug report can cite it.
 *
 * 404s are routing, not faults — they get the id (the page shape is shared) but
 * no ring-buffer entry, or a stray link would fill the buffer with noise.
 */
export const handleError: HandleClientError = ({ error, status, message }) => {
	const id = crypto.randomUUID();
	if (status !== 404) {
		logEntry('error', `[${id}] ${message}`, { src: 'boundary', error });
	}
	return { id, message };
};
