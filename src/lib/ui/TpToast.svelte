<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { toasts } from '$lib/stores/toast.svelte';

	/**
	 * doc 13 §7's toast: bottom-centre, one at a time, four seconds — the 429
	 * notice, and since Week 7 the music player's notices too (`stores/toast`).
	 *
	 * Mounted inside `(app)` rather than in the root layout, because everything
	 * that can raise one lives behind the legal gate. That also means a notice
	 * raised while the reader is on `/about` or `/legal/*` — the player keeps
	 * playing there — is not shown; the track's own mark in the library still
	 * says what happened. Styled to match `TpUpdateToast` deliberately: two
	 * notices in the same corner that look like two different apps is worse than
	 * either.
	 */
</script>

{#if toasts.current !== null}
	{@const toast = toasts.current}
	<div class="tp-toast" role="status" data-testid="toast" data-kind={toast.kind}>
		<span>{toast.kind === 'notice' ? toast.message() : m['common.toast.rate_limited']()}</span>
		<button
			type="button"
			class="tp-toast__dismiss"
			aria-label={m['common.dismiss']()}
			onclick={() => toasts.dismiss()}
		>
			×
		</button>
	</div>
{/if}

<style>
	/* Deliberately the same block as `TpUpdateToast`'s. doc 13 §7 describes one
	   toast shape, and the two components exist because their lifetimes differ,
	   not because they should look different. */
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

	.tp-toast__dismiss {
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		font: inherit;
		padding: 0.25rem 0.4rem;
		min-height: 32px;
	}
</style>
