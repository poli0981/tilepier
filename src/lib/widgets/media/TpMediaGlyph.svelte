<script lang="ts">
	/**
	 * The video player's own glyphs, on doc 12 §6's grid and stroke. Kept out of
	 * the shared set because only the video detail draws them, and `ICON_PATHS`
	 * ships in every reader's entry chunk — the weather glyphs' precedent
	 * (`wmo.ts`). Decorative: the button around each one carries the name.
	 */
	const PATHS = {
		pip: ['M3 5h18v14H3z', 'M12.5 11.5h6v5h-6z'],
		fullscreen: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
		'fullscreen-exit': ['M9 4v5H4', 'M15 4v5h5', 'M9 20v-5H4', 'M15 20v-5h5']
	} as const;

	interface Props {
		name: keyof typeof PATHS;
		size?: number;
	}

	let { name, size = 18 }: Props = $props();
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
	aria-hidden="true"
>
	{#each PATHS[name] as d (d)}
		<path {d} />
	{/each}
</svg>
