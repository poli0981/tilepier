import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	LOG_CAPACITY,
	MAX_MSG_CHARS,
	MIRROR_THROTTLE_MS,
	SESSION_KEY,
	clearLog,
	formatLog,
	installLogBuffer,
	logEntry,
	readLog,
	subscribeLog,
	type TpLogEntry
} from './log-buffer';

/** Minimal sessionStorage stand-in — the node project has no DOM. */
class MemoryStorage implements Storage {
	#map = new Map<string, string>();
	get length(): number {
		return this.#map.size;
	}
	key(i: number): string | null {
		return [...this.#map.keys()][i] ?? null;
	}
	getItem(k: string): string | null {
		return this.#map.get(k) ?? null;
	}
	setItem(k: string, v: string): void {
		this.#map.set(k, v);
	}
	removeItem(k: string): void {
		this.#map.delete(k);
	}
	clear(): void {
		this.#map.clear();
	}
}

const META = { version: '1.2.3', sha: 'abc1234', uaBrand: 'Chrome 143', locale: 'vi' };

let uninstall: () => void = () => {};
let session: MemoryStorage;
let nativeWarn: typeof console.warn;
let nativeError: typeof console.error;

beforeEach(() => {
	vi.useFakeTimers();
	session = new MemoryStorage();
	vi.stubGlobal('sessionStorage', session);
	nativeWarn = vi.fn();
	nativeError = vi.fn();
	console.warn = nativeWarn;
	console.error = nativeError;
	clearLog();
});

afterEach(() => {
	uninstall();
	uninstall = () => {};
	clearLog();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('installLogBuffer', () => {
	it('logs the boot line at info, from src boot', () => {
		uninstall = installLogBuffer(META);

		const [entry] = readLog();
		expect(entry).toMatchObject({ level: 'info', src: 'boot' });
		expect(entry?.msg).toBe('TilePier 1.2.3 abc1234 Chrome 143 vi');
	});

	it('is idempotent', () => {
		uninstall = installLogBuffer(META);
		const second = installLogBuffer(META);
		second();

		expect(readLog()).toHaveLength(1);
		// The no-op uninstaller from the second call must not detach the wrappers.
		console.warn('still captured');
		expect(readLog()).toHaveLength(2);
	});

	it('restores the natives on uninstall', () => {
		uninstall = installLogBuffer(META);
		uninstall();
		uninstall = () => {};

		console.warn('after');
		expect(readLog()).toHaveLength(1); // boot line only
		expect(nativeWarn).toHaveBeenCalledWith('after');
	});

	it('restores a tail left by a previous session', () => {
		session.setItem(
			SESSION_KEY,
			JSON.stringify([{ ts: 1, level: 'error', msg: 'from before the crash', src: 'console' }])
		);

		uninstall = installLogBuffer(META);

		expect(readLog()[0]?.msg).toBe('from before the crash');
		expect(readLog()).toHaveLength(2);
	});

	it('survives a corrupt mirror', () => {
		session.setItem(SESSION_KEY, '{not json');

		expect(() => (uninstall = installLogBuffer(META))).not.toThrow();
		expect(readLog()).toHaveLength(1);
	});
});

describe('console capture', () => {
	beforeEach(() => {
		uninstall = installLogBuffer(META);
		clearLog();
	});

	it('calls through to the native console', () => {
		console.warn('hello', 42);

		expect(nativeWarn).toHaveBeenCalledWith('hello', 42);
	});

	it('records warn and error at the right level', () => {
		console.warn('a warning');
		console.error('a failure');

		expect(readLog().map((e) => e.level)).toEqual(['warn', 'error']);
		expect(readLog()[0]?.msg).toBe('a warning');
	});

	it('keeps the newest entries once capacity is reached', () => {
		for (let i = 0; i < LOG_CAPACITY + 10; i++) console.warn(`line ${i}`);

		const log = readLog();
		expect(log).toHaveLength(LOG_CAPACITY);
		expect(log[0]?.msg).toBe('line 10');
		expect(log[log.length - 1]?.msg).toBe(`line ${LOG_CAPACITY + 9}`);
	});

	it('truncates a long message', () => {
		console.warn('x'.repeat(MAX_MSG_CHARS * 2));

		const msg = readLog()[0]?.msg ?? '';
		expect(msg).toHaveLength(MAX_MSG_CHARS);
		expect(msg.endsWith('…')).toBe(true);
	});

	it('keeps at most three stack frames', () => {
		const error = new Error('boom');
		error.stack = ['Error: boom', '    at one', '    at two', '    at three', '    at four'].join(
			'\n'
		);

		console.error(error);

		expect(readLog()[0]?.stackTop?.split('\n')).toEqual(['at one', 'at two', 'at three']);
	});

	it('serialises shallowly with a cycle guard', () => {
		const cyclic: Record<string, unknown> = { name: 'root' };
		cyclic['self'] = cyclic;

		console.warn(cyclic);

		expect(readLog()[0]?.msg).toBe('{name: root, self: [circular]}');
	});

	it('renders an Error as name and message rather than [object Object]', () => {
		console.error(new TypeError('bad input'));

		expect(readLog()[0]?.msg).toBe('TypeError: bad input');
	});

	it('does not recurse when serialisation itself throws', () => {
		const hostile = {
			get boom() {
				throw new Error('getter exploded');
			}
		};

		expect(() => console.warn(hostile)).toThrow('getter exploded');
		// The native was called before serialisation, so the developer still saw it.
		expect(nativeWarn).toHaveBeenCalled();
	});
});

describe('scrubbing', () => {
	beforeEach(() => {
		uninstall = installLogBuffer(META);
		clearLog();
	});

	it('redacts credential-shaped values', () => {
		console.warn('authorization: Bearer abc.def api_key=xyz123 secret: hunter2');

		const msg = readLog()[0]?.msg ?? '';
		expect(msg).not.toContain('abc.def');
		expect(msg).not.toContain('xyz123');
		expect(msg).not.toContain('hunter2');
		expect(msg).toContain('<redacted>');
	});

	it('redacts the token after a Bearer scheme, not just the word "Bearer"', () => {
		console.warn('authorization: Bearer eyJhbGciOi.payload.signature');

		expect(readLog()[0]?.msg).toBe('authorization=<redacted>');
	});

	it('redacts a quoted value containing spaces', () => {
		console.warn('{"api_key": "abc def ghi"}');

		const msg = readLog()[0]?.msg ?? '';
		expect(msg).not.toContain('abc def ghi');
	});

	it('leaves ordinary words containing "key" alone', () => {
		console.warn('monkey: 5 keyboard: ok');

		expect(readLog()[0]?.msg).toBe('monkey: 5 keyboard: ok');
	});

	it('strips query strings from URLs but keeps the path', () => {
		console.error('failed https://api.example.com/v1/quote?token=secret&sym=AAPL');

		const msg = readLog()[0]?.msg ?? '';
		expect(msg).toContain('https://api.example.com/v1/quote?<redacted>');
		expect(msg).not.toContain('AAPL');
	});
});

describe('sessionStorage mirror', () => {
	beforeEach(() => {
		uninstall = installLogBuffer(META);
	});

	it('throttles writes rather than mirroring on every line', () => {
		const setItem = vi.spyOn(session, 'setItem');

		console.warn('one');
		console.warn('two');
		console.warn('three');

		expect(setItem).not.toHaveBeenCalled();
		vi.advanceTimersByTime(MIRROR_THROTTLE_MS);
		expect(setItem).toHaveBeenCalledTimes(1);

		const mirrored = JSON.parse(session.getItem(SESSION_KEY) as string) as unknown[];
		expect(mirrored).toHaveLength(4); // boot line + three
	});
});

describe('logEntry, readLog and formatLog', () => {
	it('records a structured entry with its source', () => {
		logEntry('warn', 'dropped tile for unknown widget "ghost"', { src: 'layout' });

		expect(readLog()[0]).toMatchObject({ level: 'warn', src: 'layout' });
	});

	it('returns a copy, not the live buffer', () => {
		logEntry('warn', 'one');
		const snapshot = readLog() as TpLogEntry[];
		snapshot.push({ ts: 0, level: 'warn', msg: 'injected', src: 'console' });

		expect(readLog()).toHaveLength(1);
	});

	it('formats level, source and message on one line', () => {
		vi.setSystemTime(new Date('2026-08-19T10:20:30.400Z'));
		logEntry('error', 'it broke', { src: 'boundary' });

		expect(formatLog()).toBe('10:20:30.400 ERROR [boundary] it broke');
	});

	it('appends the stack under the head line', () => {
		const error = new Error('boom');
		error.stack = 'Error: boom\n    at only';
		logEntry('error', 'wrapped', { src: 'boundary', error });

		expect(formatLog().split('\n')[1]).toBe('at only');
	});
});

describe('subscribeLog', () => {
	it('coalesces bursts into one notification', () => {
		const seen = vi.fn();
		const off = subscribeLog(seen);

		logEntry('warn', 'a');
		logEntry('warn', 'b');
		logEntry('warn', 'c');

		expect(seen).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(seen).toHaveBeenCalledTimes(1);
		expect(seen.mock.calls[0]?.[0]).toHaveLength(3);

		off();
	});

	it('stops after unsubscribe', () => {
		const seen = vi.fn();
		subscribeLog(seen)();

		logEntry('warn', 'a');
		vi.advanceTimersByTime(300);

		expect(seen).not.toHaveBeenCalled();
	});
});
