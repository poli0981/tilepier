<script lang="ts">
	/**
	 * Stand-in for a real widget during spike S1. It deliberately holds state,
	 * runs an interval, and subscribes to an event — a component that did none
	 * of those would leak nothing and prove nothing.
	 */
	interface Props {
		instanceId: string;
		settings: Record<string, unknown>;
	}

	let { instanceId, settings }: Props = $props();

	let ticks = $state(0);

	$effect(() => {
		// Synchronises a visible counter with wall-clock time, so a host that is
		// unmounted incorrectly keeps mutating state and Svelte complains.
		const id = setInterval(() => (ticks += 1), 250);
		return () => clearInterval(id);
	});

	$effect(() => {
		// A window listener is the classic leak: nothing in the tile's own DOM
		// references it, so only correct teardown removes it.
		const onResize = () => void 0;
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});
</script>

<div class="dummy">
	<span class="tp-num">{ticks}</span>
	<small>{instanceId}</small>
	{#if typeof settings.label === 'string'}<small>{settings.label}</small>{/if}
</div>

<style>
	.dummy {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		justify-content: center;
		height: 100%;
		color: var(--color-fg);
	}

	.tp-num {
		font-size: var(--text-md);
		color: var(--color-beacon);
	}

	small {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
