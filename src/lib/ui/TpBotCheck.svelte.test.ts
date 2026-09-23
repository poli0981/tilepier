import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { passGate } from '$lib/core/pass';
import { m } from '$lib/paraglide/messages';
import { PASS_HEADER, TURNSTILE_ACTION } from '$lib/shared-constants';
import TpBotCheck from './TpBotCheck.svelte';
import type { TpTurnstileApi } from './turnstile';

/**
 * The bot check as a reader meets it (doc 15 §3). Cloudflare's widget is faked
 * at `window.turnstile` — the component asks for it before loading anything, so
 * no script is fetched — and `/api/verify` at `fetch`. Each case scripts what
 * the widget does: pass silently, ask for a click, or fail.
 */

type Options = Record<string, unknown>;
type Script = (options: Options) => void;

function fakeTurnstile(script: Script): TpTurnstileApi & { rendered: Options[]; resets: number } {
	const fake = {
		rendered: [] as Options[],
		resets: 0,
		render(_container: HTMLElement, options: Options) {
			fake.rendered.push(options);
			queueMicrotask(() => script(options));
			return 'widget-1';
		},
		reset() {
			fake.resets++;
			const options = fake.rendered.at(-1);
			if (options !== undefined) queueMicrotask(() => script(options));
		},
		remove() {}
	};
	window.turnstile = fake;
	return fake;
}

function call(options: Options, name: string, ...args: unknown[]): void {
	(options[name] as (...a: unknown[]) => void)(...args);
}

beforeEach(() => {
	passGate.reset();
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
			init?.method === 'POST'
				? Response.json({
						ok: true,
						data: { pass: 'pass-1', expiresAt: Date.now() + 3_600_000 },
						meta: {}
					})
				: Response.json({ ok: true, data: { sitekey: 'sitekey' }, meta: {} })
		)
	);
});

afterEach(() => {
	passGate.reset();
	delete window.turnstile;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('TpBotCheck', () => {
	it('checks on mount and, for most readers, says nothing at all', async () => {
		fakeTurnstile((options) => call(options, 'callback', 'token'));
		const screen = render(TpBotCheck);

		await vi.waitFor(() => expect(passGate.status).toBe('ready'));
		expect((await passGate.header())[PASS_HEADER]).toBe('pass-1');
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
		await expect.element(screen.getByTestId('bot-check-failed')).not.toBeInTheDocument();
	});

	it("renders with the app's action, silently unless asked, and never re-challenging", async () => {
		const fake = fakeTurnstile((options) => call(options, 'callback', 'token'));
		render(TpBotCheck);

		await vi.waitFor(() => expect(fake.rendered).toHaveLength(1));
		expect(fake.rendered[0]).toMatchObject({
			sitekey: 'sitekey',
			action: TURNSTILE_ACTION,
			appearance: 'interaction-only',
			'refresh-expired': 'never',
			'response-field': false,
			'feedback-enabled': false
		});
	});

	it('opens a labelled panel when Cloudflare asks for a click, and closes it after', async () => {
		let options: Options | undefined;
		fakeTurnstile((o) => {
			options = o;
			call(o, 'before-interactive-callback');
		});
		const screen = render(TpBotCheck);

		const dialog = screen.getByRole('dialog', { name: m['common.botcheck.title']() });
		await expect.element(dialog).toBeVisible();

		if (options !== undefined) call(options, 'callback', 'token');
		await expect.element(dialog).not.toBeInTheDocument();
		await vi.waitFor(() => expect(passGate.status).toBe('ready'));
	});

	it('says so when the check fails, and retries on request', async () => {
		let fail = true;
		const fake = fakeTurnstile((options) => {
			if (fail) call(options, 'error-callback', '110200');
			else call(options, 'callback', 'token');
		});
		const screen = render(TpBotCheck);

		const notice = screen.getByTestId('bot-check-failed');
		await expect.element(notice).toBeVisible();

		fail = false;
		await screen.getByRole('button', { name: m['common.botcheck.retry']() }).click();

		await expect.element(notice).not.toBeInTheDocument();
		expect(fake.resets).toBe(1);
		expect((await passGate.header())[PASS_HEADER]).toBe('pass-1');
	});

	it('loads and renders nothing when the Worker says there is no gate', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ ok: true, data: { sitekey: null }, meta: {} }))
		);
		const fake = fakeTurnstile(() => undefined);
		render(TpBotCheck);

		await vi.waitFor(() => expect(passGate.status).toBe('ready'));
		expect(fake.rendered).toHaveLength(0);
	});
});
