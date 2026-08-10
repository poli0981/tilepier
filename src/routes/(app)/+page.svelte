<script lang="ts">
	/**
	 * Dashboard placeholder. The grid arrives with TpGrid in Spike S1 / Week 1
	 * (doc 06 §5); this exists so the shell, tokens, and gate are verifiable
	 * end-to-end on a real deploy before any of that lands.
	 */
	import { SCHEDULER_TICK_MS } from '$lib/shared-constants';
</script>

<svelte:head>
	<title>TilePier</title>
	<meta
		name="description"
		content="Bảng điều khiển widget cục bộ — không tài khoản, không theo dõi."
	/>
</svelte:head>

<main>
	<h1>TilePier</h1>
	<p>Đài quan trắc — vỏ ứng dụng đã dựng. Lưới widget đến ở Tuần 1.</p>
	<p class="tp-meta">
		scheduler tick <span class="tp-num">{SCHEDULER_TICK_MS}</span> ms
	</p>
</main>

<style>
	main {
		max-width: 1680px;
		margin: 0 auto;
		padding: 3rem 1.5rem;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	p {
		margin: 0 0 0.5rem;
		color: var(--color-fg-mute);
	}

	.tp-meta {
		color: var(--color-fg-dim);
		font-size: var(--text-xs);
	}
</style>
