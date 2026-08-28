import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpTimerWidget from './TpTimerWidget.svelte';

/**
 * doc 07 §2's tile, and doc 06 §3's states for it.
 *
 * Every case is set up by handing the tile a settings bag with an absolute
 * `endsAt` in it, which is the same thing a reload does. That is the payoff of
 * a deadline-based timer: "the machine slept for nine hours" is a value, not a
 * scenario you have to wait for.
 *
 * The focus-session write is deliberately never triggered here. It goes to the
 * real `tilepier` database through the module singleton, and a component test
 * that leaves rows behind in the user's own IndexedDB is a bad trade for
 * coverage that `history.svelte.test.ts` already provides against a throwaway
 * database. Every case below either runs in countdown mode or completes a
 * break, neither of which logs (`service.ts`, `complete`).
 */

const MINUTE = 60_000;

const SIZE: TpTileSize = { w: 3, h: 2, pxW: 320, pxH: 160, tier: 'M' };

function props(bag: Record<string, unknown>, onUpdateSettings = vi.fn()) {
	return { instanceId: 'wgt_timer', settings: bag, size: SIZE, onUpdateSettings };
}

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
});

afterEach(() => {
	settings.dispose();
	vi.restoreAllMocks();
});

describe('countdown', () => {
	it('sits at its full duration before it is started', async () => {
		const screen = render(TpTimerWidget, props({ mode: 'countdown', durationMs: 5 * MINUTE }));

		await expect.element(screen.getByTestId('timer-readout')).toHaveTextContent('5:00');
		await expect
			.element(screen.getByTestId('timer-primary'))
			.toHaveTextContent(m['widget.timer.start']());
	});

	it('counts down from an absolute deadline', async () => {
		const screen = render(
			TpTimerWidget,
			props({ mode: 'countdown', durationMs: 5 * MINUTE, endsAt: Date.now() + 90_000 })
		);

		// A shape assertion, not an exact one: real time passes between the
		// render and the read, and pinning the second would make this flake.
		await expect.element(screen.getByTestId('timer-readout')).toHaveTextContent(/^1:(29|30)$/);
		await expect
			.element(screen.getByTestId('timer-primary'))
			.toHaveTextContent(m['widget.timer.pause']());
	});

	it('offers to resume when paused', async () => {
		const screen = render(
			TpTimerWidget,
			props({ mode: 'countdown', durationMs: 5 * MINUTE, pausedMs: 90_000 })
		);

		await expect.element(screen.getByTestId('timer-readout')).toHaveTextContent('1:30');
		await expect
			.element(screen.getByTestId('timer-primary'))
			.toHaveTextContent(m['widget.timer.resume']());
	});

	it('starts from a deadline the caller can persist', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(
			TpTimerWidget,
			props({ mode: 'countdown', durationMs: 5 * MINUTE }, onUpdateSettings)
		);

		await screen.getByTestId('timer-primary').click();

		// doc 05 §2: it goes into the tile's own settings, as an instant.
		// Through `waitFor`, not asserted straight after the click: see doc 19 §4.
		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledTimes(1);
		});
		const patch = onUpdateSettings.mock.calls[0]?.[0] as { endsAt: number; pausedMs: null };
		expect(patch.pausedMs).toBeNull();
		expect(patch.endsAt).toBeGreaterThan(Date.now());
		expect(patch.endsAt).toBeLessThanOrEqual(Date.now() + 5 * MINUTE);
	});

	it('pauses to a remainder rather than to a deadline', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(
			TpTimerWidget,
			props(
				{ mode: 'countdown', durationMs: 5 * MINUTE, endsAt: Date.now() + 90_000 },
				onUpdateSettings
			)
		);

		await screen.getByTestId('timer-primary').click();

		const patch = onUpdateSettings.mock.calls[0]?.[0] as { endsAt: null; pausedMs: number };
		expect(patch.endsAt).toBeNull();
		expect(patch.pausedMs).toBeGreaterThan(85_000);
	});
});

describe('finishing', () => {
	it('says it finished, and clears the deadline', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(
			TpTimerWidget,
			props(
				// Muted so the test does not reach for an AudioContext it cannot
				// assert on anyway; the cue is not observable from a test.
				{ mode: 'countdown', durationMs: 5 * MINUTE, endsAt: Date.now() - 1000, muted: true },
				onUpdateSettings
			)
		);

		await expect
			.element(screen.getByTestId('timer-finished'))
			.toHaveTextContent(m['widget.timer.finished']());
		await expect.element(screen.getByTestId('timer-readout')).toHaveTextContent('0:00');

		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith(
				expect.objectContaining({ endsAt: null, pausedMs: null })
			);
		});
	});

	it('says it finished while away when the deadline is long past', async () => {
		// doc 07 §2's own wording. Ten minutes late is a shut laptop, not a
		// throttled tab, and the tile says which.
		const screen = render(
			TpTimerWidget,
			props({
				mode: 'countdown',
				durationMs: 5 * MINUTE,
				endsAt: Date.now() - 10 * MINUTE,
				muted: true
			})
		);

		await expect
			.element(screen.getByTestId('timer-finished'))
			.toHaveTextContent(m['widget.timer.finished_away']());
	});

	it('announces one deadline once', async () => {
		// The readout ticks twice a second; the completion must not.
		const onUpdateSettings = vi.fn();
		render(
			TpTimerWidget,
			props(
				{ mode: 'countdown', durationMs: 5 * MINUTE, endsAt: Date.now() - 1000, muted: true },
				onUpdateSettings
			)
		);

		await new Promise((resolve) => setTimeout(resolve, 1600));
		expect(onUpdateSettings).toHaveBeenCalledTimes(1);
	});
});

describe('pomodoro', () => {
	it('shows the phase and the streak dots', async () => {
		const screen = render(
			TpTimerWidget,
			props({ mode: 'pomodoro', phase: 'focus', completed: 2, cycleLength: 4 })
		);

		await expect
			.element(screen.getByTestId('timer-phase'))
			.toHaveTextContent(m['widget.timer.phase.focus']());
		await expect
			.element(screen.getByLabelText(m['widget.timer.cycle_progress']({ done: 2, total: 4 })))
			.toBeVisible();
	});

	it('labels a break as a break', async () => {
		const screen = render(TpTimerWidget, props({ mode: 'pomodoro', phase: 'long-break' }));

		await expect
			.element(screen.getByTestId('timer-phase'))
			.toHaveTextContent(m['widget.timer.phase.long_break']());
	});

	it('returns a finished break to focus without starting it', async () => {
		// doc 07 §2: never auto-start the next phase.
		const onUpdateSettings = vi.fn();
		render(
			TpTimerWidget,
			props(
				{ mode: 'pomodoro', phase: 'break', endsAt: Date.now() - 1000, muted: true },
				onUpdateSettings
			)
		);

		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({
				endsAt: null,
				pausedMs: null,
				phase: 'focus'
			});
		});
	});

	it('shows no phase chip in countdown mode', async () => {
		const screen = render(TpTimerWidget, props({ mode: 'countdown' }));
		await expect.element(screen.getByTestId('timer-phase')).not.toBeInTheDocument();
	});
});

describe('permission-needed', () => {
	it('explains itself when notifications were asked for and refused', async () => {
		// doc 06 §3's permission-needed state, which the manifest's
		// `permissions: ['notifications']` is what makes required at all.
		vi.stubGlobal('Notification', { permission: 'denied' });

		const screen = render(TpTimerWidget, props({ mode: 'countdown', notify: true }));

		await expect
			.element(screen.getByTestId('timer-permission'))
			.toHaveTextContent(m['widget.timer.permission_blocked']());
	});

	it('stays quiet when the user never asked for notifications', async () => {
		vi.stubGlobal('Notification', { permission: 'denied' });

		const screen = render(TpTimerWidget, props({ mode: 'countdown', notify: false }));

		await expect.element(screen.getByTestId('timer-permission')).not.toBeInTheDocument();
	});
});
