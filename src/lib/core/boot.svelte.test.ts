import { beforeAll, describe, expect, it } from 'vitest';
import { LEGAL_VERSION, LOCAL_KEYS } from '$lib/shared-constants';
import { defaultSettings } from '$lib/stores/settings.svelte';

/**
 * static/boot.js, run (doc 05 §2, doc 12 §9, doc 16 §2).
 *
 * `legal.test.ts` reads the file as text: that it names the right keys and the
 * right legal version, and stays small. This runs it — as the page does, a
 * classic script against a real `<html>` and real localStorage — because a
 * reader's first paint depends on what it does, not on what it mentions.
 * Storage and the attributes are reset between tests by
 * `src/vitest-browser-setup.ts`.
 *
 * Fetched from the dev server's public directory, as the page fetches it,
 * rather than imported: Vite serves `static/` at the root and warns on an
 * import that reaches into it.
 */
let source = '';

beforeAll(async () => {
	source = await (await fetch('/boot.js')).text();
	// A missing file would come back as an HTML fallback and pass vacuously.
	expect(source).toContain('tp.settings.v1');
});

function boot(): void {
	const script = document.createElement('script');
	script.textContent = source;
	document.head.appendChild(script);
	script.remove();
}

function seedSettings(extra: Record<string, unknown>): void {
	localStorage.setItem(LOCAL_KEYS.settings, JSON.stringify({ ...defaultSettings(), ...extra }));
}

const root = document.documentElement;

describe('static/boot.js before first paint', () => {
	it('hides scrollbars when the setting says so', () => {
		seedSettings({ scrollbars: 'hidden' });

		boot();

		expect(root.getAttribute('data-scrollbars')).toBe('hidden');
	});

	it('leaves them shown for shown, absent, or anything else', () => {
		for (const value of ['shown', undefined, 'sideways', 1]) {
			root.removeAttribute('data-scrollbars');
			seedSettings({ scrollbars: value });

			boot();

			expect(root.hasAttribute('data-scrollbars'), String(value)).toBe(false);
		}
	});

	it('applies a stored theme', () => {
		seedSettings({ theme: 'light' });

		boot();

		expect(root.getAttribute('data-theme')).toBe('light');
	});

	it('marks a current acceptance, so the gate never paints', () => {
		localStorage.setItem(
			LOCAL_KEYS.legal,
			JSON.stringify({ acceptedVersion: LEGAL_VERSION, acceptedAt: 0 })
		);

		boot();

		expect(root.getAttribute('data-legal')).toBe('ok');
	});

	it('comes through corrupt settings with a theme and its scrollbars', () => {
		localStorage.setItem(LOCAL_KEYS.settings, '{not json');

		boot();

		expect(['dark', 'light']).toContain(root.getAttribute('data-theme'));
		expect(root.hasAttribute('data-scrollbars')).toBe(false);
	});
});
