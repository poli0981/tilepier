/**
 * Loading Cloudflare Turnstile's `api.js` (doc 15 §3).
 *
 * **One of exactly two third-party scripts the app loads**, and an exception
 * CLAUDE.md rule 3 names: Turnstile refuses to run from a proxied or cached
 * copy, so it cannot be bundled or self-hosted, and the CSP allows
 * `challenges.cloudflare.com` for `script-src` and `frame-src` for this and
 * nothing else. It is requested only after the legal gate is passed, and only
 * when the Worker says there is a gate at all.
 *
 * `render=explicit`: the widget is drawn by `TpBotCheck`, not by the script
 * scanning the page for a class name.
 */

/** The slice of Cloudflare's `window.turnstile` this app uses. */
export interface TpTurnstileApi {
	render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
}

declare global {
	interface Window {
		turnstile?: TpTurnstileApi;
	}
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading: Promise<TpTurnstileApi> | null = null;

/** Loads `api.js` once. A failed load is forgotten, so "retry" really retries. */
export function loadTurnstile(): Promise<TpTurnstileApi> {
	if (window.turnstile !== undefined) return Promise.resolve(window.turnstile);

	loading ??= new Promise<TpTurnstileApi>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = SCRIPT_URL;
		script.async = true;
		script.onload = () => {
			if (window.turnstile !== undefined) resolve(window.turnstile);
			else reject(new Error('turnstile: api.js loaded without window.turnstile'));
		};
		script.onerror = () => {
			loading = null;
			script.remove();
			reject(new Error('turnstile: api.js could not load'));
		};
		document.head.appendChild(script);
	});
	return loading;
}
