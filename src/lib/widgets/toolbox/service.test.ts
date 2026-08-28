import { describe, expect, it } from 'vitest';
import { pushRecentColor, readSettings } from './service';
import { RECENT_COLORS_MAX } from './types';

/** doc 07 §7's stored half — the tab and the recent-colour list. */

describe('readSettings', () => {
	it('opens on QR when nothing has been chosen', () => {
		expect(readSettings({})).toEqual({ tab: 'qr', recentColors: [] });
	});

	it('remembers the last-used tab, which is what the tile shows', () => {
		expect(readSettings({ tab: 'color' }).tab).toBe('color');
		expect(readSettings({ tab: 'password' }).tab).toBe('password');
	});

	it('ignores a tab name it does not have', () => {
		// A settings bag can come from a backup written by a later build.
		expect(readSettings({ tab: 'weather' }).tab).toBe('qr');
		expect(readSettings({ tab: 7 }).tab).toBe('qr');
	});

	it('normalises the stored colours rather than trusting them', () => {
		// What is stored has to be something the swatch can actually render.
		expect(readSettings({ recentColors: ['#FFF', '#46D5C8'] }).recentColors).toEqual([
			'#ffffff',
			'#46d5c8'
		]);
	});

	it('drops entries that are not colours', () => {
		expect(
			readSettings({ recentColors: ['#46d5c8', 'blue', null, 42, '#zzz'] }).recentColors
		).toEqual(['#46d5c8']);
	});

	it('caps a list that has grown past the limit', () => {
		const long = Array.from({ length: 30 }, (_v, i) => `#0000${i.toString(16).padStart(2, '0')}`);
		expect(readSettings({ recentColors: long }).recentColors).toHaveLength(RECENT_COLORS_MAX);
	});

	it('survives a recentColors that is not a list at all', () => {
		expect(readSettings({ recentColors: 'oops' }).recentColors).toEqual([]);
	});
});

describe('pushRecentColor', () => {
	it('puts the newest first', () => {
		expect(pushRecentColor(['#111111'], '#222222')).toEqual(['#222222', '#111111']);
	});

	it('moves a repeat to the front rather than adding a second copy', () => {
		// Eight slots is few enough that a duplicate costs a real one.
		expect(pushRecentColor(['#111111', '#222222', '#333333'], '#333333')).toEqual([
			'#333333',
			'#111111',
			'#222222'
		]);
	});

	it('normalises before comparing, so #FFF and #ffffff are one colour', () => {
		expect(pushRecentColor(['#ffffff'], '#FFF')).toEqual(['#ffffff']);
	});

	it('caps at the limit doc 07 §7 states, dropping the oldest', () => {
		const full = Array.from(
			{ length: RECENT_COLORS_MAX },
			(_v, i) => `#0000${String(i)}${String(i)}`
		);
		const next = pushRecentColor(full, '#abcdef');
		expect(next).toHaveLength(RECENT_COLORS_MAX);
		expect(next[0]).toBe('#abcdef');
		expect(next).not.toContain(full[RECENT_COLORS_MAX - 1]);
	});

	it('leaves the list alone for something that is not a colour', () => {
		expect(pushRecentColor(['#111111'], 'nope')).toEqual(['#111111']);
	});

	it('does not mutate what it was given', () => {
		const input = ['#111111'];
		pushRecentColor(input, '#222222');
		expect(input).toEqual(['#111111']);
	});
});
