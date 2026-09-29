<script lang="ts">
	/**
	 * Root layout: the global stylesheet, and settings applied to `<html>`. The
	 * icons are static files linked from app.html (doc 12 §5).
	 *
	 * The legal gate deliberately lives one level down, in `(app)/+layout.svelte`,
	 * so it wraps the deck but not `/legal/*` — a visitor has to be able to read
	 * the terms the gate links to before agreeing to them (doc 16 §2).
	 */
	import '../app.css';
	import TpUpdateToast from '$lib/ui/TpUpdateToast.svelte';
	import { settings } from '$lib/stores/settings.svelte';

	let { children } = $props();

	// Settings own <html> after hydration; static/boot.js owns it before first
	// paint. This lives in the root layout rather than in (app) because theme
	// and lang also apply on /legal/* and /about, which sit outside the gate.
	//
	// hydrate() is not called here — hooks.client.ts `init` does it, before
	// hydration, so nothing can read settings before they are loaded. Reading
	// them here is what makes this effect re-run when they change.
	$effect(() => {
		settings.applyToDocument();
	});
</script>

{@render children()}

<TpUpdateToast />
