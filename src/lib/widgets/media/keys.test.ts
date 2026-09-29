import { describe, expect, it } from 'vitest';
import { keyAction, SEEK_STEP_S, VOLUME_STEP, type TpKeyTarget } from './keys';

/** The player's keyboard map (doc 09 §3, Week 7 plan S16), rule by rule. */

function press(key: string, target: TpKeyTarget = 'other', modifiers: Partial<KeyboardEvent> = {}) {
	return keyAction({ key, altKey: false, ctrlKey: false, metaKey: false, ...modifiers }, target);
}

describe('keyAction', () => {
	it('maps the keys doc 09 §3 names', () => {
		expect(press(' ')).toEqual({ kind: 'toggle' });
		expect(press('k')).toEqual({ kind: 'toggle' });
		expect(press('ArrowLeft')).toEqual({ kind: 'seek', bySeconds: -SEEK_STEP_S });
		expect(press('ArrowRight')).toEqual({ kind: 'seek', bySeconds: SEEK_STEP_S });
		expect(press('ArrowUp')).toEqual({ kind: 'volume', by: VOLUME_STEP });
		expect(press('ArrowDown')).toEqual({ kind: 'volume', by: -VOLUME_STEP });
		expect(press('M')).toEqual({ kind: 'mute' });
		expect(press('f')).toEqual({ kind: 'fullscreen' });
		expect(press('C')).toEqual({ kind: 'captions' });
	});

	it('leaves a key a control already answers to the control', () => {
		// Space presses a button; answering it too would do it twice.
		expect(press(' ', 'button')).toBeNull();
		expect(press('k', 'button')).toEqual({ kind: 'toggle' });
		// The arrows move a range.
		expect(press('ArrowLeft', 'range')).toBeNull();
		expect(press('ArrowUp', 'range')).toBeNull();
		expect(press(' ', 'range')).toEqual({ kind: 'toggle' });
		// Nothing typed into a field is a player key.
		expect(press('f', 'field')).toBeNull();
		expect(press('c', 'field')).toBeNull();
		expect(press(' ', 'field')).toBeNull();
	});

	it('leaves any key with a modifier to the browser, and Escape to the detail', () => {
		expect(press('f', 'other', { ctrlKey: true })).toBeNull();
		expect(press('ArrowLeft', 'other', { altKey: true })).toBeNull();
		expect(press('m', 'other', { metaKey: true })).toBeNull();
		expect(press('Escape')).toBeNull();
		expect(press('Tab')).toBeNull();
	});
});
