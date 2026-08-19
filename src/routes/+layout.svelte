<script lang="ts">
	/**
	 * Root layout: global stylesheet and favicon only.
	 *
	 * The legal gate deliberately lives one level down, in `(app)/+layout.svelte`,
	 * so it wraps the deck but not `/legal/*` — a visitor has to be able to read
	 * the terms the gate links to before agreeing to them (doc 16 §2).
	 */
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import TpUpdateToast from '$lib/ui/TpUpdateToast.svelte';
	import { settings } from '$lib/stores/settings.svelte';

	let { children } = $props();

	// Settings own <html> after hydration; static/boot.js owns it before first
	// paint. This lives in the root layout rather than in (app) because theme
	// and lang also apply on /legal/* and /about, which sit outside the gate.
	$effect(() => {
		settings.hydrate();
		settings.applyToDocument();
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{@render children()}

<TpUpdateToast />
