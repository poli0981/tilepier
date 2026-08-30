<script lang="ts">
	import { WMO_PATHS, type TpWmoGlyph } from './wmo';

	/**
	 * The weather half of doc 12 §6's icon set — same 1.75 px stroke, 24 px grid
	 * and `currentColor` as `TpIcon`, a different path table (see `wmo.ts` for
	 * why the two are not one component).
	 *
	 * `label` is not optional here. Every place this renders, the glyph *is* the
	 * condition — there is no adjacent text naming it — so a decorative icon
	 * would drop the forecast's only description of the weather.
	 */
	interface Props {
		glyph: TpWmoGlyph;
		label: string;
		size?: number;
	}

	let { glyph, label, size = 20 }: Props = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	role="img"
	aria-label={label}
>
	{#each WMO_PATHS[glyph] as d (d)}
		<path {d} />
	{/each}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
