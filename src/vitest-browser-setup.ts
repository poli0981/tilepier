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

const RESET_ATTRIBUTES = ['data-theme', 'data-motion', 'data-legal'];

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();

	const root = document.documentElement;
	for (const attribute of RESET_ATTRIBUTES) root.removeAttribute(attribute);
	// app.html ships lang="vi"; restore that rather than leaving it unset, so a
	// test that never touches locale sees the same starting point as the app.
	root.setAttribute('lang', 'vi');
	root.style.removeProperty('--color-beacon');
});
