<script lang="ts">
	import type { TpWidgetProps } from '$lib/core/types';

	/**
	 * A widget that does nothing, so a host can be mounted on its own.
	 *
	 * `TpWidgetHost` takes the component to render as a prop, and every real
	 * widget brings a scheduler entry, a `swr` subscription or a timer with it —
	 * none of which the host's own tests are about. This renders the size it was
	 * handed and stops there.
	 */
	let { size }: TpWidgetProps = $props();
</script>

<p data-testid="stub-body">{size.w}×{size.h}</p>
