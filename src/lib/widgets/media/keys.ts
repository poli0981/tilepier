/**
 * The video player's keys (doc 09 §3's keyboard map; Week 7 plan S16), as a
 * pure function of the key and what it landed on, so the rules test without a
 * page.
 *
 * - Space or K plays and pauses; ← → move five seconds; ↑ ↓ change the volume
 *   by a tenth; M mutes; F goes full screen; C shows or hides subtitles.
 * - **A key a control already answers is left to it.** Space on a button
 *   presses the button, so the player must not also toggle, or one press would
 *   do it twice. The arrows on a range move the range. Nothing typed into a
 *   field or a select is a player key.
 * - **Any modifier leaves the key alone**: Ctrl+F is the browser's find, and
 *   Alt+← its back.
 * - **Escape is never the player's**: it closes the detail, or it leaves full
 *   screen, and the overlay decides which (ui/dialog-keys.ts).
 */

export type TpKeyAction =
	| { kind: 'toggle' }
	| { kind: 'seek'; bySeconds: number }
	| { kind: 'volume'; by: number }
	| { kind: 'mute' }
	| { kind: 'fullscreen' }
	| { kind: 'captions' };

/** What a key landed on, as far as these rules care. */
export type TpKeyTarget = 'button' | 'range' | 'field' | 'other';

export const SEEK_STEP_S = 5;
export const VOLUME_STEP = 0.1;

interface TpKey {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

export function keyAction(event: TpKey, target: TpKeyTarget): TpKeyAction | null {
	if (event.altKey || event.ctrlKey || event.metaKey || target === 'field') return null;
	switch (event.key) {
		case ' ':
			return target === 'button' ? null : { kind: 'toggle' };
		case 'k':
		case 'K':
			return { kind: 'toggle' };
		case 'ArrowLeft':
			return target === 'range' ? null : { kind: 'seek', bySeconds: -SEEK_STEP_S };
		case 'ArrowRight':
			return target === 'range' ? null : { kind: 'seek', bySeconds: SEEK_STEP_S };
		case 'ArrowUp':
			return target === 'range' ? null : { kind: 'volume', by: VOLUME_STEP };
		case 'ArrowDown':
			return target === 'range' ? null : { kind: 'volume', by: -VOLUME_STEP };
		case 'm':
		case 'M':
			return { kind: 'mute' };
		case 'f':
		case 'F':
			return { kind: 'fullscreen' };
		case 'c':
		case 'C':
			return { kind: 'captions' };
		default:
			return null;
	}
}

/** Sorts a keydown's target for `keyAction`. */
export function targetOf(target: EventTarget | null): TpKeyTarget {
	if (!(target instanceof HTMLElement)) return 'other';
	if (target instanceof HTMLButtonElement) return 'button';
	if (target instanceof HTMLInputElement) return target.type === 'range' ? 'range' : 'field';
	if (target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return 'field';
	return target.isContentEditable ? 'field' : 'other';
}
