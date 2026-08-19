import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_KEYS } from '$lib/shared-constants';
import { clearLog, logEntry } from './log-buffer';
import { collectEnv, formatReport, issueUrl, shortHash } from './bug-report';

/**
 * doc 18 §2's environment block. The assertions that matter are the negative
 * ones: this is the only payload that leaves the device, and it leaves because
 * a user chose to send it, so it must not carry anything they did not expect.
 */

const BASE = {
	version: '1.0.0',
	sha: 'a1b2c3d',
	locale: 'vi',
	theme: 'dark',
	widgetIds: ['clock', 'clock', 'weather'] as const,
	online: true
};

beforeEach(() => {
	clearLog();
	vi.stubGlobal('navigator', { userAgent: 'TestAgent/1.0', serviceWorker: undefined });
	vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2 });
	vi.stubGlobal('localStorage', {
		getItem: (key: string) =>
			key === LOCAL_KEYS.layout ? '{"schemaVersion":1,"grid":[{"widgetId":"clock"}]}' : null
	});
	vi.stubGlobal('indexedDB', {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	clearLog();
});

describe('shortHash', () => {
	it('is stable and six hex characters', () => {
		expect(shortHash('abc')).toMatch(/^[0-9a-f]{6}$/);
		expect(shortHash('abc')).toBe(shortHash('abc'));
	});

	it('separates different layouts', () => {
		expect(shortHash('{"grid":[1]}')).not.toBe(shortHash('{"grid":[2]}'));
	});
});

describe('collectEnv', () => {
	it('counts widgets rather than listing instances', () => {
		expect(collectEnv({ ...BASE }).widgets).toBe('clock×2, weather');
	});

	it('says "none" for an empty deck rather than an empty string', () => {
		expect(collectEnv({ ...BASE, widgetIds: [] }).widgets).toBe('none');
	});

	it('says "none" when no layout has been stored yet', () => {
		vi.stubGlobal('localStorage', { getItem: () => null });

		expect(collectEnv({ ...BASE }).layoutHash).toBe('none');
	});

	it('reports the service worker state, or its absence', () => {
		expect(collectEnv({ ...BASE }).swState).toBe('none');

		vi.stubGlobal('navigator', {
			userAgent: 'TestAgent/1.0',
			serviceWorker: { controller: { state: 'activated' } }
		});
		expect(collectEnv({ ...BASE }).swState).toBe('activated');
	});

	it('notes a missing IndexedDB rather than assuming it is there', () => {
		vi.stubGlobal('indexedDB', undefined);

		expect(collectEnv({ ...BASE }).storage).toBe('idb missing');
	});

	it('reports offline as plainly as online', () => {
		expect(collectEnv({ ...BASE, online: false }).online).toBe('no');
	});

	it('carries a layout hash, never the layout', () => {
		const env = collectEnv({ ...BASE });

		expect(env.layoutHash).toMatch(/^[0-9a-f]{6}$/);
		expect(JSON.stringify(env)).not.toContain('grid');
	});
});

describe('formatReport', () => {
	it('includes the environment and the log', () => {
		logEntry('warn', 'something odd', { src: 'layout' });

		const report = formatReport(collectEnv({ ...BASE }));

		expect(report).toContain('version: 1.0.0 (a1b2c3d)');
		expect(report).toContain('--- log ---');
		expect(report).toContain('something odd');
	});

	it('leads with the error id when one is given', () => {
		const report = formatReport(collectEnv({ ...BASE }), 'abc-123');

		expect(report.split('\n')[0]).toBe('error id: abc-123');
	});

	it('omits the id line entirely when there is none', () => {
		expect(formatReport(collectEnv({ ...BASE }))).not.toContain('error id');
	});

	it('carries the log already scrubbed', () => {
		logEntry('error', 'authorization: Bearer supersecret.jwt');

		const report = formatReport(collectEnv({ ...BASE }));

		// log-buffer scrubs at write time, so the report cannot un-scrub it.
		expect(report).not.toContain('supersecret');
		expect(report).toContain('<redacted>');
	});
});

describe('issueUrl', () => {
	it('prefills only the short fields', () => {
		const url = new URL(issueUrl('1.0.0'));

		expect(url.searchParams.get('template')).toBe('bug_report.yml');
		expect(url.searchParams.get('labels')).toBe('bug');
		expect(url.searchParams.get('version')).toBe('1.0.0');
		// doc 18 §4: the log goes by clipboard — ~8 KB is the practical URL
		// ceiling and a log tail blows straight through it.
		expect(url.searchParams.has('logs')).toBe(false);
		expect(url.toString().length).toBeLessThan(200);
	});
});
