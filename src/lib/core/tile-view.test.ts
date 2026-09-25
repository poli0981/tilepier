import { describe, expect, it } from 'vitest';
import type { TpSwrStatus } from './swr.svelte';
import { tileView } from './tile-view';

function source(status: TpSwrStatus, shown = false) {
	return { status, shown };
}

describe('tileView (doc 06 §3)', () => {
	it('lists as soon as any source has something on screen', () => {
		expect(tileView([source('error'), source('stale-error', true)])).toBe('list');
		expect(tileView([source('loading'), source('fresh', true)])).toBe('list');
	});

	it('holds the skeleton while one source is still asking and none has answered', () => {
		expect(tileView([source('error'), source('loading')])).toBe('loading');
		expect(tileView([source('offline'), source('idle')])).toBe('loading');
	});

	it('holds the skeleton for a tile with no sources yet', () => {
		// A tile whose sources are still being made — rss hashes its feed URLs
		// before it can subscribe to any of them.
		expect(tileView([])).toBe('loading');
	});

	it('names the most telling failure when nothing can be shown', () => {
		expect(tileView([source('error'), source('offline'), source('rate-limited')])).toBe('offline');
		expect(tileView([source('rate-limited'), source('error')])).toBe('rate-limited');
		expect(tileView([source('error'), source('error')])).toBe('error');
	});
});
