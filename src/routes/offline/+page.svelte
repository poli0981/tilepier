<script lang="ts">
	/**
	 * Service-worker fallback for navigations that fail while offline
	 * (doc 17 §1, §2). Precached, so it must never import anything heavy — it is
	 * the one page that has to work when nothing else does.
	 */
	import { resolve } from '$app/paths';
	import { LOCALES } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
</script>

<svelte:head><title>{m['common.offline.page_title']()}</title></svelte:head>

<!-- Prerendered prose, so both locales ship and CSS picks (doc 14 §6). -->
<main>
	{#each LOCALES as locale (locale)}
		<div data-locale={locale}>
			<h1>{m['common.offline.title'](undefined, { locale })}</h1>
			<p>{m['common.offline.body'](undefined, { locale })}</p>
			<p><a href={resolve('/')}>{m['common.back_to_deck'](undefined, { locale })}</a></p>
		</div>
	{/each}
</main>

<style>
	main {
		max-width: 34rem;
		margin: 0 auto;
		padding: 4rem 1.5rem;
	}

	h1 {
		margin: 0 0 0.75rem;
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--color-warn);
	}

	p {
		margin: 0 0 0.75rem;
		color: var(--color-fg-mute);
	}

	a {
		color: var(--color-beacon);
	}
</style>
