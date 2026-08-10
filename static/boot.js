/**
 * Pre-paint boot script. Loaded synchronously from <head> — it must run before
 * the first paint, so no `defer`, no `async`, no module.
 *
 * Why a separate file rather than an inline <script>: CSP is `script-src 'self'`
 * with no 'unsafe-inline' (doc 15 §2), so an inline block would be blocked.
 * This is the CSP-safe way to have blocking pre-paint logic.
 *
 * It does three things, all of which must happen before anything renders:
 *
 *  1. Legal gate (doc 16 §2). The gate has to appear pre-JS, so the prerendered
 *     HTML always contains it. But acceptance lives in localStorage, which the
 *     prerenderer cannot know — so without this script every returning user
 *     would see the gate flash on each load. Setting data-legal="ok" here lets
 *     CSS hide it before paint.
 *  2. Theme, so there is no dark/light flash.
 *  3. Locale on <html lang>, which matters for hyphenation and screen readers.
 *
 * Keep this file dependency-free, tiny, and defensive: a throw here would
 * block the whole app. Every read is wrapped — corrupt JSON must never stop
 * the shell from rendering (doc 05 §5).
 */
(function () {
	'use strict';

	/**
	 * MUST equal LEGAL_VERSION in src/lib/shared-constants.ts.
	 * A test asserts the two agree, because this file cannot import it.
	 */
	var LEGAL_VERSION = 1;

	var root = document.documentElement;

	function readJSON(key) {
		try {
			var raw = localStorage.getItem(key);
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	}

	// ── legal gate ────────────────────────────────────────────────────────────
	try {
		var legal = readJSON('tp.legal.v1');
		if (legal && typeof legal.acceptedVersion === 'number' && legal.acceptedVersion >= LEGAL_VERSION) {
			root.setAttribute('data-legal', 'ok');
		}
	} catch {
		/* gate stays up — failing closed is correct here */
	}

	// ── theme + locale ────────────────────────────────────────────────────────
	try {
		var settings = readJSON('tp.settings.v1') || {};

		var theme = settings.theme;
		if (theme !== 'dark' && theme !== 'light') {
			theme =
				window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
					? 'light'
					: 'dark';
		}
		root.setAttribute('data-theme', theme);

		var locale = settings.locale;
		if (locale !== 'vi' && locale !== 'en') {
			// doc 14 §1: default from navigator.language, vi* → vi, else en.
			var nav = (navigator.language || 'en').toLowerCase();
			locale = nav.indexOf('vi') === 0 ? 'vi' : 'en';
		}
		root.setAttribute('lang', locale);
	} catch {
		/* the markup defaults (dark, vi) already cover this */
	}
})();
