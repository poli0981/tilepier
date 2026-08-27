/**
 * The completion cue (doc 07 §2): a sound and, if the user asked for it, a
 * Notification.
 *
 * **The sound is synthesised, not a file.** doc 07 §2 says "audio cue
 * (self-hosted, respects a mute setting)", and a bundled sample would mean an
 * asset to licence, a row in the doc 16 §5 attribution register, and bytes in
 * a budget — for two notes. Two oscillators are ~40 lines, ship nothing, and
 * are self-hosted in the sense doc 15 §2 cares about: no request leaves the
 * page. (Decision taken 2026-08-27.)
 */

/** A perfect fifth, short. Long enough to notice, short enough not to startle
 *  — doc 12 §8's register applies to sound as much as to copy. */
const NOTES = [
	{ hz: 880, at: 0, forMs: 180 },
	{ hz: 1318.5, at: 0.16, forMs: 320 }
] as const;

const PEAK_GAIN = 0.18;

/**
 * Plays the cue. Silent when muted, and silent — without complaining — when
 * the browser will not give an AudioContext.
 *
 * Autoplay policy is the reason for the `catch` rather than a check: a context
 * created outside a user gesture starts `suspended`, and whether `resume()`
 * succeeds depends on whether the page has ever been interacted with. A timer
 * the user started by clicking has been; one restored from storage and expiring
 * in a background tab may not have, and that is a case where failing quietly is
 * right. The Notification is the channel that still works there.
 */
export async function playChime(muted: boolean): Promise<void> {
	if (muted) return;
	if (typeof AudioContext === 'undefined') return;

	let ctx: AudioContext | null = null;
	try {
		ctx = new AudioContext();
		if (ctx.state === 'suspended') await ctx.resume();

		const start = ctx.currentTime;
		let endsAt = start;

		for (const note of NOTES) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();

			// A sine with an exponential decay: no click on attack, no buzz on
			// release. A square wave here sounds like an error, which is the wrong
			// thing to say about a finished pomodoro.
			osc.type = 'sine';
			osc.frequency.value = note.hz;

			const from = start + note.at;
			const to = from + note.forMs / 1000;
			gain.gain.setValueAtTime(0.0001, from);
			gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, from + 0.015);
			gain.gain.exponentialRampToValueAtTime(0.0001, to);

			osc.connect(gain).connect(ctx.destination);
			osc.start(from);
			osc.stop(to);
			endsAt = Math.max(endsAt, to);
		}

		// Contexts are a finite resource — a few dozen per page in Chromium — and
		// a timer that fires four times an hour would exhaust them over a working
		// day. Closing after the tail has played is the whole fix.
		const tailMs = (endsAt - start) * 1000 + 100;
		const closing = ctx;
		setTimeout(() => void closing.close().catch(() => undefined), tailMs);
	} catch {
		// No audio output, a blocked context, or a browser that refuses to
		// resume. None of those is worth a visible error for a chime.
		void ctx?.close().catch(() => undefined);
	}
}

/**
 * Asks for Notification permission, once, on the user's explicit action.
 *
 * doc 07 §2: permission is requested when the setting is first enabled, never
 * on load — an unprompted permission dialog on a dashboard is the pattern this
 * project's charter exists to avoid.
 */
export async function requestNotifyPermission(): Promise<NotificationPermission> {
	if (typeof Notification === 'undefined') return 'denied';
	if (Notification.permission !== 'default') return Notification.permission;
	try {
		return await Notification.requestPermission();
	} catch {
		return 'denied';
	}
}

/** What the tile renders as `permission-needed` (doc 06 §3) turns on. */
export function notifyPermission(): NotificationPermission {
	return typeof Notification === 'undefined' ? 'denied' : Notification.permission;
}

/** Fires the completion notice. A no-op unless the user both asked for it and
 *  the browser agreed — neither is inferred from the other. */
export function notifyDone(title: string, body: string): void {
	if (notifyPermission() !== 'granted') return;
	try {
		// `tag` collapses repeats: a timer that finished while the tab was hidden
		// should leave one notice, not one per tick of whatever noticed it.
		new Notification(title, { body, tag: 'tp-timer' });
	} catch {
		// Some browsers throw here on mobile, where the Notification constructor
		// requires a service worker registration. Falling silent is correct: the
		// tile is already showing the finished state.
	}
}
