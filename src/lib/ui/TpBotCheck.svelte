<script lang="ts">
	import { passGate, type TpPassStatus } from '$lib/core/pass';
	import { m } from '$lib/paraglide/messages';
	import { TURNSTILE_ACTION } from '$lib/shared-constants';
	import { settings } from '$lib/stores/settings.svelte';
	import { loadTurnstile } from './turnstile';

	/**
	 * The bot check on entry (doc 15 §3, doc 13 §7).
	 *
	 * Mounted by the `(app)` layout only after the legal gate is passed, and it
	 * primes `passGate` the moment it mounts — so the check runs while the deck
	 * is still loading its tiles, and a returning reader's cached tiles are on
	 * screen before the first pass is needed.
	 *
	 * Most visitors never see it. The widget renders with
	 * `appearance: 'interaction-only'`: Cloudflare decides silently, and the
	 * panel below only opens when it asks for a click. When it cannot decide at
	 * all — blocked script, network down, refused — the one global notice says
	 * so and offers a retry, while each networked tile shows its own error and
	 * keeps whatever it had.
	 */

	let container = $state<HTMLElement | null>(null);
	let panel = $state<HTMLElement | null>(null);
	let interactive = $state(false);
	let status = $state<TpPassStatus>(passGate.status);

	let widgetId: string | undefined;
	let pending: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;

	function settle(outcome: { token: string } | { error: string }): void {
		const current = pending;
		pending = null;
		interactive = false;
		if (current === null) return;
		if ('token' in outcome) current.resolve(outcome.token);
		else current.reject(new Error(`turnstile: ${outcome.error}`));
	}

	/** Runs one challenge. A second call resets the same widget. */
	async function challenge(sitekey: string): Promise<string> {
		const turnstile = await loadTurnstile();
		const target = container;
		if (target === null) throw new Error('turnstile: no container');

		return new Promise<string>((resolve, reject) => {
			pending = { resolve, reject };
			if (widgetId !== undefined) {
				turnstile.reset(widgetId);
				return;
			}
			widgetId = turnstile.render(target, {
				sitekey,
				action: TURNSTILE_ACTION,
				appearance: 'interaction-only',
				theme: settings.theme === 'system' ? 'auto' : settings.theme,
				language: settings.locale,
				// The token is traded once; nothing here needs it refreshed, and
				// the default re-challenges every five minutes for no reader.
				'refresh-expired': 'never',
				'response-field': false,
				'feedback-enabled': false,
				callback: (token: string) => settle({ token }),
				'error-callback': (code: string) => {
					settle({ error: String(code) });
					return true;
				},
				'timeout-callback': () => settle({ error: 'timeout' }),
				'unsupported-callback': () => settle({ error: 'unsupported' }),
				'before-interactive-callback': () => {
					interactive = true;
				},
				'after-interactive-callback': () => {
					interactive = false;
				}
			});
		});
	}

	$effect(() => {
		const unsubscribe = passGate.subscribe((next) => {
			status = next;
		});
		passGate.prime(challenge);
		return () => {
			unsubscribe();
			if (widgetId !== undefined) window.turnstile?.remove(widgetId);
			widgetId = undefined;
		};
	});

	// A challenge that needs a click takes focus, so a keyboard reader lands in
	// it rather than hunting for a panel that appeared somewhere below.
	$effect(() => {
		if (interactive) panel?.focus();
	});
</script>

<div
	class="tp-botcheck"
	class:tp-botcheck--open={interactive}
	role={interactive ? 'dialog' : undefined}
	aria-label={interactive ? m['common.botcheck.title']() : undefined}
	tabindex="-1"
	bind:this={panel}
	data-testid="bot-check"
>
	{#if interactive}
		<p class="tp-botcheck__title">{m['common.botcheck.title']()}</p>
	{/if}
	<div bind:this={container}></div>
</div>

{#if status === 'failed'}
	<div class="tp-toast" role="status" data-testid="bot-check-failed">
		<span>{m['common.botcheck.failed']()}</span>
		<button type="button" class="tp-toast__action" onclick={() => passGate.retry()}>
			{m['common.botcheck.retry']()}
		</button>
	</div>
{/if}

<style>
	/* Closed, the panel is a 1 px well the invisible check can run in — not
	   `display: none`, which some engines treat as "not rendered" for an iframe. */
	.tp-botcheck {
		position: fixed;
		bottom: 0;
		left: 0;
		width: 1px;
		height: 1px;
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
	}

	.tp-botcheck--open {
		bottom: 4.5rem;
		left: 50%;
		z-index: 210;
		width: auto;
		height: auto;
		overflow: visible;
		transform: translateX(-50%);
		opacity: 1;
		pointer-events: auto;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-850);
		box-shadow: var(--shadow-tile);
		padding: 0.875rem 1rem;
	}

	.tp-botcheck__title {
		margin: 0 0 0.625rem;
		color: var(--color-fg);
		font-size: var(--text-xs);
	}

	/* doc 13 §7's one toast shape — the same block as TpRateLimitToast's. */
	.tp-toast {
		position: fixed;
		bottom: 1.25rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 200;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
		color: var(--color-fg);
		font-size: var(--text-xs);
		padding: 0.5rem 0.75rem;
		box-shadow: var(--shadow-tile);
	}

	.tp-toast__action {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		min-height: 32px;
		padding: 0.25rem 0.6rem;
	}
</style>
