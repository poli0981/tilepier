import type { Page } from '@playwright/test';

/**
 * What the page writes to its Media Session — what the OS would show on its
 * lock screen and answer its media keys from — recorded by an init script from
 * before the page's first script. Shared by journey-music and journey-media.
 *
 * The fixtures last seconds, so rather than race them, the tests read the
 * history: every title and playback state the page wrote, and what the session
 * holds now.
 */

export interface TpSessionLog {
	titles: (string | null)[];
	states: string[];
	/** What the session holds now. */
	state: string;
	title: string | null;
}

type TpRecorded = Omit<TpSessionLog, 'state' | 'title'>;

export async function recordSession(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const log = { titles: [] as (string | null)[], states: [] as string[] };
		(window as unknown as { __tpSession: typeof log }).__tpSession = log;
		const proto = MediaSession.prototype;
		for (const [name, into] of [
			[
				'metadata',
				(value: unknown) => log.titles.push((value as MediaMetadata | null)?.title ?? null)
			],
			['playbackState', (value: unknown) => log.states.push(String(value))]
		] as const) {
			const real = Object.getOwnPropertyDescriptor(proto, name);
			Object.defineProperty(proto, name, {
				configurable: true,
				get(this: MediaSession) {
					return real?.get?.call(this);
				},
				set(this: MediaSession, value: unknown) {
					into(value);
					real?.set?.call(this, value);
				}
			});
		}
	});
}

export async function sessionLog(page: Page): Promise<TpSessionLog> {
	return page.evaluate(() => {
		const log = (window as unknown as { __tpSession: TpRecorded }).__tpSession;
		return {
			titles: [...log.titles],
			states: [...log.states],
			state: navigator.mediaSession.playbackState,
			title: navigator.mediaSession.metadata?.title ?? null
		};
	});
}

export async function clearSessionLog(page: Page): Promise<void> {
	await page.evaluate(() => {
		const log = (window as unknown as { __tpSession: TpRecorded }).__tpSession;
		log.titles.length = 0;
		log.states.length = 0;
	});
}
