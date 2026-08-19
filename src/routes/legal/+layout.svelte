<script lang="ts">
	/**
	 * Static legal pages (doc 03 §Rendering: prerendered, SEO, loads before JS).
	 * They sit outside the gate on purpose — a visitor must be able to read the
	 * terms before agreeing to them.
	 */
	import TpProse from '$lib/ui/TpProse.svelte';

	let { children } = $props();
</script>

<TpProse>{@render children()}</TpProse>
