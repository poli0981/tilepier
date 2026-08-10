<script lang="ts">
	/**
	 * Service-worker fallback for navigations that fail while offline
	 * (doc 17 §1, §2). Precached, so it must never import anything heavy — it is
	 * the one page that has to work when nothing else does.
	 */
	import { resolve } from '$app/paths';
</script>

<svelte:head><title>Ngoại tuyến — TilePier</title></svelte:head>

<main>
	<h1>ngoại tuyến</h1>
	<p>Không có kết nối. Bàn làm việc và dữ liệu đã lưu vẫn ở nguyên trên máy bạn.</p>
	<p><a href={resolve('/')}>◂ về bàn</a></p>
</main>

<style>
	main {
		max-width: 34rem;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}

	h1 {
		margin: 0 0 0.75rem;
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--color-warn);
	}

	p {
		margin: 0 0 0.75rem;
		color: var(--color-fg-mute);
	}

	a {
		color: var(--color-beacon);
	}
</style>
