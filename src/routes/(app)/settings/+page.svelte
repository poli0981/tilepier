<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import TpProse from '$lib/ui/TpProse.svelte';
	import TpSettingsPanel from '$lib/ui/settings/TpSettingsPanel.svelte';

	/**
	 * doc 13 §10. A thin wrapper: the panel is a component so it can be rendered
	 * in a browser test without stubbing routing, and so a future command
	 * palette could reuse it.
	 *
	 * Inside the `(app)` group, and therefore behind the legal gate — it exposes
	 * data wipe and diagnostics.
	 */
</script>

<svelte:head><title>{m['settings.page_title']()}</title></svelte:head>

<TpProse>
	<TpSettingsPanel />
</TpProse>
