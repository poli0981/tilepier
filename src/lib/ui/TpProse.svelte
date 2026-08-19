<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { LOCALES } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	/**
	 * Shell for the prerendered prose pages — /legal/* and /about (doc 13 §11).
	 * They share a measure and a way back, and they sit outside the gate, since
	 * a visitor has to be able to read what they are agreeing to first.
	 *
	 * Children are dual-rendered by their own page (doc 14 §6); only the back
	 * link belongs to this shell, so it dual-renders here.
	 */
	let { children }: { children: Snippet } = $props();
</script>

<article>
	{@render children()}

	<p class="tp-back">
		{#each LOCALES as locale (locale)}
			<span data-locale={locale}>
				<a href={resolve('/')}>{m['common.back_to_deck'](undefined, { locale })}</a>
			</span>
		{/each}
	</p>
</article>

<style>
	article {
		max-width: 42rem;
		margin: 0 auto;
		padding: 3rem 1.5rem;
	}

	/* :global because the content arrives through a snippet from the page. */
	article :global(h1) {
		margin: 0 0 1rem;
		font-size: var(--text-lg);
		font-weight: 600;
	}

	article :global(h2) {
		margin: 2rem 0 0.5rem;
		font-size: var(--text-base);
		font-weight: 600;
		color: var(--color-fg);
	}

	article :global(p) {
		margin: 0 0 1rem;
		color: var(--color-fg-mute);
	}

	article :global(ol),
	article :global(ul) {
		margin: 0 0 1rem;
		padding-left: 1.25rem;
		color: var(--color-fg-mute);
	}

	article :global(li) {
		margin-bottom: 0.5rem;
	}

	article :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0 0 1rem;
		font-size: var(--text-xs);
		color: var(--color-fg-mute);
	}

	article :global(th),
	article :global(td) {
		border-bottom: 1px solid var(--color-ink-700);
		padding: 0.5rem 0.75rem 0.5rem 0;
		text-align: left;
		vertical-align: top;
	}

	article :global(th) {
		color: var(--color-fg);
		font-weight: 500;
	}

	/* Wide content scrolls inside its own box rather than the page (doc 13 §6). */
	article :global(.tp-scroll) {
		overflow-x: auto;
	}

	.tp-back {
		margin-top: 2rem;
	}

	.tp-back a {
		color: var(--color-beacon);
	}
</style>
