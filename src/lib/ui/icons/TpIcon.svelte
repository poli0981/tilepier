<script lang="ts">
	import { ICON_PATHS, type TpIconName } from './names';

	/**
	 * doc 12 §6: 1.75 px stroke, 24 px grid, round caps, `currentColor` so a
	 * glyph takes the colour of whatever it sits in — category icons are
	 * `fg-mute`, never rainbow (doc 12 §4).
	 *
	 * An icon with no `label` is decorative and hidden from assistive tech; the
	 * accessible name then has to come from the control around it. Passing a
	 * `label` makes it an image with a name of its own.
	 */
	interface Props {
		name: TpIconName;
		label?: string | undefined;
		size?: number;
	}

	let { name, label = undefined, size = 20 }: Props = $props();
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
	role={label === undefined ? 'presentation' : 'img'}
	aria-hidden={label === undefined ? 'true' : undefined}
	aria-label={label}
>
	{#each ICON_PATHS[name] as d (d)}
		<path {d} />
	{/each}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
