<script lang="ts">
	import { pwa } from '$lib/core/pwa.svelte';

	/**
	 * Bottom-centre, max one visible, only for global events (doc 13 §7).
	 * doc 17 §2: the copy is deliberately quiet and the reload only happens
	 * when the user asks for it.
	 */
	$effect(() => {
		// Synchronises the service worker registration with the app's lifetime.
		void pwa.init();
	});
</script>

{#if pwa.updateReady}
	<div class="tp-toast" role="status" data-testid="update-toast">
		<span>phiên bản mới</span>
		<button type="button" data-testid="update-reload" onclick={() => pwa.applyUpdate()}>
			tải lại
		</button>
		<button
			type="button"
			class="tp-toast__dismiss"
			aria-label="bỏ qua"
			onclick={() => pwa.dismiss()}
		>
			×
		</button>
	</div>
{:else if pwa.offlineReady}
	<div class="tp-toast" role="status" data-testid="offline-ready">
		<span>sẵn sàng dùng ngoại tuyến</span>
		<button
			type="button"
			class="tp-toast__dismiss"
			aria-label="bỏ qua"
			onclick={() => pwa.dismiss()}
		>
			×
		</button>
	</div>
{/if}

<style>
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

	.tp-toast button {
		border: 0;
		background: none;
		color: var(--color-beacon);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		padding: 0.25rem 0.4rem;
		min-height: 32px;
	}

	.tp-toast__dismiss {
		color: var(--color-fg-dim);
		font-weight: 400;
	}
</style>
