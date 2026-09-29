import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawPoster, encodePoster, POSTER_MAX_BYTES } from './poster';

/**
 * A video's still (doc 09 §3): nothing drawn from a video with nothing to
 * show, and the JPEG ladder — 0.7, then 0.55, then 0.4, then no still at all.
 */

afterEach(() => {
	vi.restoreAllMocks();
});

/** toBlob answering with JPEGs of these sizes, one per call, noting each quality. */
function sizes(...bytes: number[]): number[] {
	const qualities: number[] = [];
	vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
		callback: BlobCallback,
		_type?: string,
		quality?: number
	) {
		qualities.push(quality ?? -1);
		const size = bytes.shift() ?? 0;
		callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
	});
	return qualities;
}

describe('encodePoster', () => {
	it('steps down the qualities until the still fits', async () => {
		const qualities = sizes(POSTER_MAX_BYTES + 900, POSTER_MAX_BYTES + 1, 30_000);

		const still = await encodePoster(document.createElement('canvas'));

		expect(still?.size).toBe(30_000);
		expect(qualities).toEqual([0.7, 0.55, 0.4]);
	});

	it('keeps no still when none fits', async () => {
		sizes(90_000, 80_000, 70_000);

		expect(await encodePoster(document.createElement('canvas'))).toBeNull();
	});

	it('stops at the first that fits', async () => {
		const qualities = sizes(12_000);

		expect((await encodePoster(document.createElement('canvas')))?.size).toBe(12_000);
		expect(qualities).toEqual([0.7]);
	});
});

describe('drawPoster', () => {
	it('draws nothing from a video with nothing to show yet', () => {
		expect(drawPoster(document.createElement('video'))).toBeNull();
	});
});
