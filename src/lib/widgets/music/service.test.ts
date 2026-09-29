import { describe, expect, it } from 'vitest';
import type { TpTrack } from '$lib/core/storage/db';
import {
	buildQueue,
	currentId,
	EMPTY_QUEUE,
	libraryOrder,
	readPosition,
	readQueue,
	reshuffle,
	shuffleRest,
	stepIndex,
	upNextId,
	type TpQueue
} from './service';

function track(id: string, fields: Partial<TpTrack> = {}): TpTrack {
	return { id, source: 'blob', title: id, artist: '', album: '', addedAt: 0, ...fields };
}

/** A dealer that always picks the lowest card left: a known permutation. */
const lowest = () => 0;

describe('libraryOrder', () => {
	it('sorts by artist, album, track number and title, numbers read as numbers', () => {
		const sorted = libraryOrder([
			track('b10', { artist: 'B', album: 'X', trackNo: 10 }),
			track('b9', { artist: 'B', album: 'X', trackNo: 9 }),
			track('a', { artist: 'a', album: 'Z' }),
			track('none', { artist: '' }),
			track('b-y', { artist: 'B', album: 'Y', trackNo: 1 })
		]);

		expect(sorted.map((t) => t.id)).toEqual(['a', 'b9', 'b10', 'b-y', 'none']);
	});

	it('puts tracks with no artist last, not first', () => {
		expect(
			libraryOrder([track('x', { artist: '' }), track('y', { artist: 'Y' })]).map((t) => t.id)
		).toEqual(['y', 'x']);
	});
});

describe('shuffleRest', () => {
	it('keeps the first place and deals the rest', () => {
		const dealt = shuffleRest([4, 0, 1, 2, 3], lowest);

		expect(dealt[0]).toBe(4);
		expect([...dealt].sort()).toEqual([0, 1, 2, 3, 4]);
		expect(dealt).not.toEqual([4, 0, 1, 2, 3]);
	});

	it('is a permutation whatever the dealer does', () => {
		let seed = 7;
		const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
		const dealt = shuffleRest(
			Array.from({ length: 50 }, (_, i) => i),
			random
		);

		expect(dealt[0]).toBe(0);
		expect(new Set(dealt).size).toBe(50);
	});
});

describe('queues', () => {
	const ids = ['a', 'b', 'c', 'd'];

	it('starts where it was asked to, in order when not shuffled', () => {
		const queue = buildQueue(ids, 'c', { kind: 'library' }, false);

		expect(currentId(queue)).toBe('c');
		expect(queue.order).toEqual([0, 1, 2, 3]);
	});

	it('plays the chosen track first when shuffled, and the others after it', () => {
		const queue = buildQueue(ids, 'c', { kind: 'library' }, true, lowest);

		expect(currentId(queue)).toBe('c');
		expect(queue.index).toBe(0);
		expect([...queue.order].sort()).toEqual([0, 1, 2, 3]);
	});

	it('keeps the current track through a shuffle and back', () => {
		const plain = buildQueue(ids, 'b', { kind: 'library' }, false);

		const shuffled = reshuffle(plain, true, lowest);
		expect(currentId(shuffled)).toBe('b');

		const back = reshuffle(shuffled, false);
		expect(currentId(back)).toBe('b');
		expect(back.order).toEqual([0, 1, 2, 3]);
	});

	it('steps within the queue, wraps only on repeat-all, and stops at the ends otherwise', () => {
		const last: TpQueue = { ...buildQueue(ids, 'd', { kind: 'library' }, false) };
		const first: TpQueue = { ...buildQueue(ids, 'a', { kind: 'library' }, false) };

		expect(stepIndex(first, 1, 'off')).toBe(1);
		expect(stepIndex(last, 1, 'off')).toBeNull();
		// Repeat-one replays a track that *ends*; a press of next still moves on,
		// and at the end of the queue it stops like repeat-off.
		expect(stepIndex(last, 1, 'one')).toBeNull();
		expect(stepIndex(last, 1, 'all')).toBe(0);
		expect(stepIndex(first, -1, 'all')).toBe(3);
		expect(stepIndex(first, -1, 'off')).toBeNull();
		expect(stepIndex(EMPTY_QUEUE, 1, 'all')).toBeNull();
	});

	it('names what plays next, and nothing past a non-wrapping end', () => {
		expect(upNextId(buildQueue(ids, 'b', { kind: 'library' }, false), 'off')).toBe('c');
		expect(upNextId(buildQueue(ids, 'd', { kind: 'library' }, false), 'off')).toBeUndefined();
		expect(upNextId(buildQueue(ids, 'd', { kind: 'library' }, false), 'all')).toBe('a');
	});
});

describe('reading the saved rows back', () => {
	const position = {
		trackId: 't1',
		positionMs: 12_000,
		shuffle: false,
		repeat: 'all',
		volume: 0.5
	};

	it('takes a well-formed position', () => {
		expect(readPosition(position)).toEqual(position);
		expect(readPosition({ ...position, trackId: null })).toMatchObject({ trackId: null });
	});

	it('refuses anything it cannot trust', () => {
		for (const bad of [
			null,
			'x',
			{ ...position, trackId: 3 },
			{ ...position, positionMs: -1 },
			{ ...position, positionMs: Number.NaN },
			{ ...position, shuffle: 'yes' },
			{ ...position, repeat: 'twice' },
			{ ...position, volume: 2 }
		]) {
			expect(readPosition(bad)).toBeNull();
		}
	});

	const queue = {
		source: { kind: 'playlist', id: 'p1' },
		trackIds: ['a', 'b'],
		order: [1, 0],
		index: 1
	};

	it('takes a well-formed queue', () => {
		expect(readQueue(queue)).toEqual(queue);
		expect(readQueue({ ...queue, trackIds: [], order: [], index: 0 })).not.toBeNull();
	});

	it('refuses a queue whose order is not a permutation of its tracks', () => {
		for (const bad of [
			{ ...queue, source: { kind: 'radio' } },
			{ ...queue, trackIds: ['a', 2] },
			{ ...queue, order: [0] },
			{ ...queue, order: [0, 0] },
			{ ...queue, order: [0, 5] },
			{ ...queue, index: 2 },
			{ ...queue, index: -1 }
		]) {
			expect(readQueue(bad)).toBeNull();
		}
	});
});
