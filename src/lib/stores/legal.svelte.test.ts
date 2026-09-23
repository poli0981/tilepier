import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { LEGAL_VERSION, LOCAL_KEYS } from '$lib/shared-constants';
import { legalGate } from './legal.svelte';

/**
 * The reactive half of the gate. `core/legal.svelte.test.ts` covers storage;
 * this covers what the deck waits on — and that the wait ends the moment the
 * visitor accepts, without a reload.
 */

function store(version: number): void {
	localStorage.setItem(
		LOCAL_KEYS.legal,
		JSON.stringify({ acceptedVersion: version, acceptedAt: '2026-09-01T00:00:00Z' })
	);
}

beforeEach(() => {
	localStorage.clear();
	legalGate.sync();
});

afterEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-legal');
});

describe('legalGate', () => {
	it('is closed with nothing stored', () => {
		expect(legalGate.accepted).toBe(false);
	});

	it('opens on accept, writes the acceptance, and is observable at once', () => {
		const seen: boolean[] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				seen.push(legalGate.accepted);
			});
		});
		flushSync();

		legalGate.accept();
		flushSync();

		expect(seen).toEqual([false, true]);
		expect(JSON.parse(localStorage.getItem(LOCAL_KEYS.legal) ?? '{}').acceptedVersion).toBe(
			LEGAL_VERSION
		);
		stop();
	});

	it('picks up an acceptance already in storage', () => {
		store(LEGAL_VERSION);
		expect(legalGate.sync()).toBe(true);
		expect(legalGate.accepted).toBe(true);
	});

	it('stays closed for an acceptance of an older version', () => {
		store(LEGAL_VERSION - 1);
		expect(legalGate.sync()).toBe(false);
	});
});
