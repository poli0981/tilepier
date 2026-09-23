import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSION, LOCAL_KEYS } from '$lib/shared-constants';
import { acceptLegal, hasAcceptedLegal, previousLegalVersion } from './legal';

/**
 * The gate's own logic, which had no direct test until now — `legal.test.ts`
 * checks static/boot.js as text, which is a different thing entirely.
 *
 * Every case here fails *closed*. doc 16 §2 calls this a real gate rather than
 * an overlay, and a gate that opens on malformed input is not one.
 */

beforeEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-legal');
	document.documentElement.removeAttribute('data-legal-prev');
});

afterEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-legal');
	vi.restoreAllMocks();
});

describe('hasAcceptedLegal', () => {
	it('is false with nothing stored', () => {
		expect(hasAcceptedLegal()).toBe(false);
	});

	it('is true once the current version is accepted', () => {
		acceptLegal();

		expect(hasAcceptedLegal()).toBe(true);
	});

	it('is true for a newer acceptance than this build knows about', () => {
		localStorage.setItem(
			LOCAL_KEYS.legal,
			JSON.stringify({ acceptedVersion: LEGAL_VERSION + 5, acceptedAt: '2026-01-01T00:00:00Z' })
		);

		expect(hasAcceptedLegal()).toBe(true);
	});

	it('re-gates when the constant moves past the stored acceptance', () => {
		localStorage.setItem(
			LOCAL_KEYS.legal,
			JSON.stringify({ acceptedVersion: LEGAL_VERSION - 1, acceptedAt: '2026-01-01T00:00:00Z' })
		);

		// doc 16 §2: bumping LEGAL_VERSION on a material change re-gates.
		expect(hasAcceptedLegal()).toBe(false);
	});

	it('fails closed on corrupt JSON', () => {
		localStorage.setItem(LOCAL_KEYS.legal, '{not json');

		expect(hasAcceptedLegal()).toBe(false);
	});

	it('fails closed on a plausible but wrong shape', () => {
		for (const value of ['null', '"yes"', '{}', '{"acceptedVersion":"1"}', '[]']) {
			localStorage.setItem(LOCAL_KEYS.legal, value);
			expect(hasAcceptedLegal(), value).toBe(false);
		}
	});
});

describe('acceptLegal', () => {
	it('records the version and an ISO timestamp', () => {
		acceptLegal();

		const stored = JSON.parse(localStorage.getItem(LOCAL_KEYS.legal) as string) as {
			acceptedVersion: number;
			acceptedAt: string;
		};
		expect(stored.acceptedVersion).toBe(LEGAL_VERSION);
		expect(new Date(stored.acceptedAt).toISOString()).toBe(stored.acceptedAt);
	});

	it('lifts the gate for this document', () => {
		acceptLegal();

		expect(document.documentElement.dataset['legal']).toBe('ok');
	});

	it('still lifts the gate when storage refuses the write', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});

		expect(() => acceptLegal()).not.toThrow();
		// Private mode: the session proceeds and the gate returns next visit,
		// which is better than trapping the user behind a wall they agreed to.
		expect(document.documentElement.dataset['legal']).toBe('ok');
	});
});

// doc 16 §2's "what changed" line, which no code drew until LEGAL_VERSION 2.
describe('previousLegalVersion', () => {
	function stored(version: unknown): void {
		localStorage.setItem(
			LOCAL_KEYS.legal,
			JSON.stringify({ acceptedVersion: version, acceptedAt: '2026-09-01T00:00:00Z' })
		);
	}

	it('names the older version a returning reader agreed to', () => {
		stored(LEGAL_VERSION - 1);
		expect(previousLegalVersion()).toBe(LEGAL_VERSION - 1);
	});

	it('is null for a first visit, a current acceptance, and anything unreadable', () => {
		expect(previousLegalVersion()).toBeNull();
		stored(LEGAL_VERSION);
		expect(previousLegalVersion()).toBeNull();
		stored('1');
		expect(previousLegalVersion()).toBeNull();
		localStorage.setItem(LOCAL_KEYS.legal, '{not json');
		expect(previousLegalVersion()).toBeNull();
	});

	it('is cleared from the page by accepting', () => {
		document.documentElement.setAttribute('data-legal-prev', '1');
		acceptLegal();
		expect(document.documentElement.hasAttribute('data-legal-prev')).toBe(false);
	});
});
