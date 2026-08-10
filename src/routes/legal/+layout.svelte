<script lang="ts">
	/**
	 * Static legal pages (doc 03 §Rendering: prerendered, SEO, loads before JS).
	 * They sit outside the gate on purpose — a visitor must be able to read the
	 * terms before agreeing to them.
	 */
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<article>
	{@render children()}
	<p class="tp-back"><a href={resolve('/')}>◂ về bàn</a></p>
</article>

<style>
	article {
		max-width: 42rem;
		margin: 0 auto;
		padding: 3rem 1.5rem;
	}

	article :global(h1) {
		margin: 0 0 1rem;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	article :global(p) {
		margin: 0 0 1rem;
		color: var(--color-fg-mute);
	}

	.tp-back {
		margin-top: 2rem;
	}

	.tp-back a {
		color: var(--color-beacon);
	}
</style>
