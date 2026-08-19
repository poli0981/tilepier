import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_KEYS } from '$lib/shared-constants';
import { defaultSettings, settings, type TpSettings } from './settings.svelte';

/**
 * doc 19 §1: settings round-trips are a component-layer concern, so this runs
 * in the browser project — it needs a real `matchMedia`, a real `<html>`, and a
 * real `storage` event.
 *
 * The store is a module singleton; `dispose()` then `hydrate()` is how a test
 * gets a clean one. Storage and `<html>` are reset by
 * `src/vitest-browser-setup.ts` before each test.
 */

function seed(partial: Partial<TpSettings> = {}): void {
	localStorage.setItem(LOCAL_KEYS.settings, JSON.stringify({ ...defaultSettings(), ...partial }));
}

function stored(): TpSettings {
	return JSON.parse(localStorage.getItem(LOCAL_KEYS.settings) as string) as TpSettings;
}

beforeEach(() => {
	settings.dispose();
});

afterEach(() => {
	settings.dispose();
});

describe('hydrate', () => {
	it('reads a stored value', () => {
		seed({ clock24h: false, accent: '#ff8800' });

		settings.hydrate();

		expect(settings.clock24h).toBe(false);
		expect(settings.accent).toBe('#ff8800');
	});

	it('falls back to defaults when nothing is stored, without writing', () => {
		settings.hydrate();

		expect(settings.theme).toBe('system');
		expect(localStorage.getItem(LOCAL_KEYS.settings)).toBeNull();
	});

	it('is idempotent', () => {
		settings.hydrate();
		settings.patch({ clock24h: false });
		settings.hydrate();

		// A second hydrate must not re-read and discard the in-memory change.
		expect(settings.clock24h).toBe(false);
	});

	it('quarantines a corrupt value and still comes up usable', () => {
		localStorage.setItem(LOCAL_KEYS.settings, '{not json');

		settings.hydrate();

		expect(settings.theme).toBe('system');
		expect(Object.keys(localStorage).some((k) => k.startsWith('tp.corrupt.'))).toBe(true);
	});
});

describe('applyToDocument', () => {
	it('mirrors theme, locale, motion and accent onto <html>', () => {
		seed({ theme: 'light', locale: 'en', reducedMotion: 'on', accent: '#ff8800' });
		settings.hydrate();

		settings.applyToDocument();

		const root = document.documentElement;
		expect(root.getAttribute('data-theme')).toBe('light');
		expect(root.getAttribute('lang')).toBe('en');
		expect(root.getAttribute('data-motion')).toBe('reduced');
		expect(root.style.getPropertyValue('--color-beacon')).toBe('#ff8800');
	});

	it('resolves theme "system" against the media query', () => {
		seed({ theme: 'system' });
		settings.hydrate();

		settings.applyToDocument();

		// Assert against the runner's actual preference rather than a guess —
		// headless Chromium reports light, but that is not ours to depend on.
		const expected = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		expect(settings.resolvedTheme).toBe(expected);
		expect(document.documentElement.getAttribute('data-theme')).toBe(expected);
	});

	it('sets only --color-beacon, leaving the derived variants to CSS', () => {
		seed({ accent: '#ff8800' });
		settings.hydrate();

		settings.applyToDocument();

		const inline = document.documentElement.style;
		expect(inline.getPropertyValue('--color-beacon-soft')).toBe('');
		expect(inline.getPropertyValue('--color-beacon-deep')).toBe('');
	});
});

describe('motionOK', () => {
	it('is false when the user forced reduced motion on', () => {
		seed({ reducedMotion: 'on' });
		settings.hydrate();

		expect(settings.motionOK).toBe(false);
	});

	it('is true when the user forced it off, whatever the OS says', () => {
		seed({ reducedMotion: 'off' });
		settings.hydrate();

		expect(settings.motionOK).toBe(true);
	});

	it('follows the media query on "system"', () => {
		seed({ reducedMotion: 'system' });
		settings.hydrate();

		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		expect(settings.motionOK).toBe(!reduced);
	});
});

describe('patch and reset', () => {
	it('writes through immediately — there is no save button', () => {
		settings.hydrate();

		settings.patch({ clock24h: false });

		expect(stored().clock24h).toBe(false);
	});

	it('leaves untouched fields alone', () => {
		seed({ accent: '#ff8800' });
		settings.hydrate();

		settings.patch({ clock24h: false });

		expect(settings.accent).toBe('#ff8800');
		expect(stored().accent).toBe('#ff8800');
	});

	it('does not write when the patch changes nothing', () => {
		seed({ locale: 'vi' });
		settings.hydrate();
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		settings.patch({ locale: 'vi' });

		// Not a micro-optimisation. Paraglide's getLocale() writes the resolved
		// locale back through every strategy the first time a message renders,
		// and that call lands inside a component — a rune mutation there is
		// state_unsafe_mutation, which took the whole deck down once.
		expect(setItem).not.toHaveBeenCalled();
	});

	it('restores defaults', () => {
		seed({ clock24h: false, theme: 'light' });
		settings.hydrate();

		settings.reset();

		expect(settings.clock24h).toBe(true);
		expect(settings.theme).toBe('system');
		expect(stored().theme).toBe('system');
	});

	it('exposes a plain snapshot that does not alias internal state', () => {
		settings.hydrate();

		const snapshot = settings.snapshot as TpSettings;
		settings.patch({ clock24h: false });

		expect(snapshot.clock24h).toBe(true);
	});
});

describe('cross-tab sync', () => {
	it("applies another tab's write", () => {
		settings.hydrate();
		const next = { ...defaultSettings(), clock24h: false, accent: '#123456' };

		window.dispatchEvent(
			new StorageEvent('storage', {
				key: LOCAL_KEYS.settings,
				newValue: JSON.stringify(next),
				storageArea: localStorage
			})
		);

		expect(settings.clock24h).toBe(false);
		expect(settings.accent).toBe('#123456');
	});

	it('ignores writes to other keys', () => {
		settings.hydrate();

		window.dispatchEvent(
			new StorageEvent('storage', {
				key: LOCAL_KEYS.layout,
				newValue: '{"schemaVersion":1,"grid":[]}',
				storageArea: localStorage
			})
		);

		expect(settings.clock24h).toBe(true);
	});

	it('stops listening after dispose', () => {
		settings.hydrate();
		settings.dispose();

		window.dispatchEvent(
			new StorageEvent('storage', {
				key: LOCAL_KEYS.settings,
				newValue: JSON.stringify({ ...defaultSettings(), clock24h: false }),
				storageArea: localStorage
			})
		);

		expect(settings.clock24h).toBe(true);
	});
});
