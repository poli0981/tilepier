<script module lang="ts">
	/** Whether the widget throws on its next render; the test flips it. */
	export const crash = { on: true };
</script>

<script lang="ts">
	import type { TpWidgetProps } from '$lib/core/types';

	/**
	 * A widget that throws while it renders, for as long as `crash.on` is true —
	 * the host's boundary under test (doc 17 §6). Once the flag is down it
	 * renders an empty marker, which is what Retry should bring back. It takes
	 * the props every widget takes, so it is a widget as far as the host's type
	 * is concerned, and reads none of them.
	 */
	const _props: TpWidgetProps = $props();
	if (crash.on) throw new Error('the widget broke');
</script>

<p data-testid="throwing-recovered"></p>
