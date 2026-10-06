import { beforeEach } from 'vitest';

/**
 * Setup for the `client` (browser mode) Vitest project.
 *
 * Component cleanup is deliberately *not* here: vitest-browser-svelte 2.2.1
 * registers its own `beforeEach(cleanup)` from its main entry (see
 * `dist/index.mjs`), so any test file that imports `render` already has it.
 * Adding a second one would just run cleanup twice.
 *
 * What is not handled for us is global state. The settings and deck stores
 * write to localStorage and to `<html>`; without a reset between tests they
 * pass in isolation and fail in sequence, which is the worst kind of flake to
 * chase.
 */

/**
 * No test reaches the dev server's `/api/*`. Those routes are SvelteKit server
 * code, which this browser-mode server cannot run: a request that got there
 * printed "Cannot read properties of undefined (reading 'wrapDynamicImport')"
 * from `get_hooks`, on every run of the weather and rss tile tests (found in
 * Week 8). The requests were late ones — work still in flight after a test
 * had handed `fetch` back with `vi.unstubAllGlobals()` — so they changed no
 * result, only the output. A test that wants an answer stubs `fetch`, as every
 * one already does; what reaches the real one now fails as a network error
 * would, here, instead of in the server.
 */
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(input instanceof Request ? input.url : String(input), location.href);
	if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
		return Promise.reject(new TypeError(`no test talks to the dev server: ${url.pathname}`));
	}
	return realFetch(input, init);
};

const RESET_ATTRIBUTES = ['data-theme', 'data-motion', 'data-legal', 'data-scrollbars'];

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();

	const root = document.documentElement;
	for (const attribute of RESET_ATTRIBUTES) root.removeAttribute(attribute);
	// app.html ships lang="vi"; restore that rather than leaving it unset, so a
	// test that never touches locale sees the same starting point as the app.
	root.setAttribute('lang', 'vi');
	root.style.removeProperty('--tp-accent');
});
