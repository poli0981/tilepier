import type { ClientInit, HandleClientError } from '@sveltejs/kit';
import { installLogBuffer, logEntry } from '$lib/core/log-buffer';
import { installLocaleStrategy } from '$lib/i18n';
import { deck } from '$lib/stores/deck.svelte';
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
	// Order is load-bearing: the locale strategy reads the settings store, and
	// the boot line reports the resolved locale.
	settings.hydrate();
	// The deck is hydrated here rather than on the deck page, because it is not
	// only the deck page that needs it — a bug report filed from /settings has
	// to know which widgets are on the deck (doc 18 §2), and it reported "none"
	// until this moved.
	deck.hydrate();
	installLocaleStrategy();
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
