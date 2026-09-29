import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	clearSession,
	pageSession,
	writeSessionHandlers,
	writeSessionMetadata,
	writeSessionPosition,
	writeSessionState,
	type TpMediaSession
} from './media-session';

/**
 * The guards, against a stand-in session that can be made as strict — or as
 * old — as a real browser, and the real `MediaMetadata` of the one the tests
 * run in.
 */

class FakeSession implements TpMediaSession {
	metadata: MediaMetadata | null = null;
	playbackState: MediaSessionPlaybackState = 'none';
	handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
	positions: (MediaPositionState | undefined)[] = [];
	/** Actions this "browser" does not know: setting one throws, as Safari's does. */
	unknown = new Set<MediaSessionAction>();
	/** Throw on every position, as a browser stricter than the spec would. */
	strict = false;

	setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
		if (this.unknown.has(action)) throw new TypeError(`unknown action: ${action}`);
		this.handlers.set(action, handler);
	}

	setPositionState(state?: MediaPositionState): void {
		if (this.strict) throw new TypeError('no');
		this.positions.push(state);
	}
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('pageSession', () => {
	it('is the page’s session where the browser has one', () => {
		expect(pageSession()).toBe(navigator.mediaSession);
	});

	it('is null where it does not', () => {
		vi.stubGlobal('navigator', {});
		expect(pageSession()).toBeNull();
	});
});

describe('writeSessionHandlers', () => {
	it('sets the named actions, and every other one to null', () => {
		const session = new FakeSession();
		const play = vi.fn();
		session.handlers.set('seekforward', () => {}); // the last owner's

		writeSessionHandlers(session, { play });

		expect(session.handlers.get('play')).toBe(play);
		expect(session.handlers.get('seekforward')).toBeNull();
		expect(session.handlers.get('seekto')).toBeNull();
		expect(session.handlers.size).toBe(8);
	});

	it('goes on past an action the browser does not know', () => {
		const session = new FakeSession();
		session.unknown.add('seekto');
		const next = vi.fn();

		writeSessionHandlers(session, { seekto: vi.fn(), nexttrack: next });

		expect(session.handlers.has('seekto')).toBe(false);
		expect(session.handlers.get('nexttrack')).toBe(next);
	});
});

describe('writeSessionMetadata', () => {
	it('writes the words, and the cover when there is one', () => {
		const session = new FakeSession();

		writeSessionMetadata(session, {
			title: 'Hà Nội mùa thu',
			artist: 'Mỹ Tâm',
			album: 'Tâm',
			artwork: { src: 'blob:https://tilepier.win/cover', type: 'image/png' }
		});
		expect(session.metadata?.title).toBe('Hà Nội mùa thu');
		expect(session.metadata?.artist).toBe('Mỹ Tâm');
		expect(session.metadata?.album).toBe('Tâm');
		expect(session.metadata?.artwork[0]?.type).toBe('image/png');

		writeSessionMetadata(session, { title: 'Không bìa', artist: '', album: '' });
		expect(session.metadata?.artwork).toHaveLength(0);
	});

	it('keeps what it had when the artwork will not parse', () => {
		const session = new FakeSession();
		writeSessionMetadata(session, { title: 'Trước', artist: '', album: '' });

		writeSessionMetadata(session, {
			title: 'Sau',
			artist: '',
			album: '',
			artwork: { src: 'http://[', type: 'image/png' }
		});

		expect(session.metadata?.title).toBe('Trước');
	});

	it('writes nothing in a browser without MediaMetadata', () => {
		const session = new FakeSession();
		vi.stubGlobal('MediaMetadata', undefined);

		writeSessionMetadata(session, { title: 'x', artist: '', album: '' });

		expect(session.metadata).toBeNull();
	});
});

describe('writeSessionPosition', () => {
	it('clears the position for a length it does not know, rather than throw', () => {
		const session = new FakeSession();

		writeSessionPosition(session, Number.NaN, 0);
		writeSessionPosition(session, 0, 0);
		writeSessionPosition(session, Number.POSITIVE_INFINITY, 1000);

		expect(session.positions).toEqual([undefined, undefined, undefined]);
	});

	it('writes seconds, and holds a position past either end at that end', () => {
		const session = new FakeSession();

		writeSessionPosition(session, 60_000, 30_000);
		writeSessionPosition(session, 60_000, 90_000);
		writeSessionPosition(session, 60_000, -5);
		writeSessionPosition(session, 60_000, Number.NaN);

		expect(session.positions).toEqual([
			{ duration: 60, position: 30, playbackRate: 1 },
			{ duration: 60, position: 60, playbackRate: 1 },
			{ duration: 60, position: 0, playbackRate: 1 },
			{ duration: 60, position: 0, playbackRate: 1 }
		]);
	});

	it('does nothing where the browser predates it, and survives one that throws', () => {
		const old: TpMediaSession = {
			metadata: null,
			playbackState: 'none',
			setActionHandler: () => {}
		};
		expect(() => writeSessionPosition(old, 60_000, 0)).not.toThrow();

		const strict = new FakeSession();
		strict.strict = true;
		expect(() => writeSessionPosition(strict, 60_000, 0)).not.toThrow();
	});
});

describe('writeSessionState and clearSession', () => {
	it('says playing or paused, and clearing leaves no words, keys or position', () => {
		const session = new FakeSession();
		writeSessionHandlers(session, { play: vi.fn(), pause: vi.fn() });
		writeSessionMetadata(session, { title: 'x', artist: '', album: '' });
		writeSessionState(session, 'playing');
		expect(session.playbackState).toBe('playing');

		clearSession(session);

		expect(session.metadata).toBeNull();
		expect(session.playbackState).toBe('none');
		expect([...session.handlers.values()].every((handler) => handler === null)).toBe(true);
		expect(session.positions.at(-1)).toBeUndefined();
	});
});
