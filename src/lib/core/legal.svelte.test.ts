import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGAL_VERSION, LOCAL_KEYS } from '$lib/shared-constants';
import { acceptLegal, hasAcceptedLegal } from './legal';

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
