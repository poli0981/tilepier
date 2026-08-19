<script lang="ts">
	import { settings } from '$lib/stores/settings.svelte';

	/**
	 * "Tide gauge" — the house motif (doc 12 §5). A vertical tick ruler like the
	 * water-level gauge on a pier piling: short-short-long repeating, with the
	 * current level glowing beacon.
	 *
	 * Used at most once per view. It is the logo mark, the skeleton shimmer, and
	 * the empty-state illustration; this component is all three, differing only
	 * in `level` and `animated`.
	 */
	interface Props {
		/** 0–1, bottom to top. */
		level?: number;
		animated?: boolean;
		size?: number;
	}

	let { level = 0.55, animated = false, size = 24 }: Props = $props();

	// doc 12 §7: reduced motion is decided in one place, never by a component
	// reading the media query itself.
	const moving = $derived(animated && settings.motionOK);

	const TICKS = 12;
	const clamped = $derived(Math.min(1, Math.max(0, level)));
	const waterY = $derived(2 + (1 - clamped) * 20);
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	role="presentation"
	aria-hidden="true"
	class:moving
>
	<!-- The piling: ticks run short · short · long, repeating up the rule. -->
	{#each Array.from({ length: TICKS }, (_, i) => i) as i (i)}
		<line
			x1="9"
			x2={i % 3 === 2 ? 17 : 13}
			y1={2 + i * (20 / (TICKS - 1))}
			y2={2 + i * (20 / (TICKS - 1))}
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			opacity={i % 3 === 2 ? 0.7 : 0.35}
		/>
	{/each}

	<line x1="7" x2="7" y1="2" y2="22" stroke="currentColor" stroke-width="1.75" opacity="0.5" />

	<!-- The waterline is the one thing that glows. -->
	<line
		class="tp-gauge__water"
		x1="4"
		x2="20"
		y1={waterY}
		y2={waterY}
		stroke="var(--color-beacon)"
		stroke-width="2"
		stroke-linecap="round"
	/>
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}

	.tp-gauge__water {
		filter: drop-shadow(0 0 3px var(--color-beacon));
	}

	.moving .tp-gauge__water {
		animation: tp-tide 2.6s ease-in-out infinite alternate;
	}

	@keyframes tp-tide {
		from {
			transform: translateY(1.5px);
		}
		to {
			transform: translateY(-1.5px);
		}
	}
</style>
