<script lang="ts">
	import { resolve } from '$app/paths';
	import { LOCALES } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import TpProse from '$lib/ui/TpProse.svelte';

	/**
	 * doc 13 §11. Two other docs already pointed at this page for their
	 * documented limitations before it existed — doc 13 §6 (one stored layout,
	 * not one per breakpoint) and doc 04 §7 (two tabs are last-writer-wins).
	 * Writing them down where a user can find them is the point of the page.
	 *
	 * `__TP_BUILD__` is replaced at build time (doc 03 §Environment), so the
	 * version line is baked into the prerendered HTML and needs no JavaScript.
	 */
	const REPO = 'https://github.com/poli0981/tilepier';
</script>

<svelte:head><title>{m['about.page_title']()}</title></svelte:head>

<TpProse>
	{#each LOCALES as locale (locale)}
		<div data-locale={locale}>
			<h1>{m['about.title'](undefined, { locale })}</h1>
			<p>{m['about.what_is'](undefined, { locale })}</p>
			<p>
				{m['about.privacy_line'](undefined, { locale })}
				<a href={resolve('/legal/privacy')}>{m['legal.privacy.title'](undefined, { locale })}</a>
			</p>

			<h2>{m['about.limitations.title'](undefined, { locale })}</h2>
			<ul>
				<li>{m['about.limitations.layout'](undefined, { locale })}</li>
				<li>{m['about.limitations.tabs'](undefined, { locale })}</li>
			</ul>

			<p class="tp-build">
				{m['about.build']({ version: __TP_BUILD__.version, sha: __TP_BUILD__.sha }, { locale })}
				·
				<a href={REPO}>{m['about.links.repo'](undefined, { locale })}</a>
				·
				<a href={resolve('/legal/licenses')}>{m['about.links.licence'](undefined, { locale })}</a>
			</p>
		</div>
	{/each}
</TpProse>

<style>
	.tp-build {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		color: var(--color-fg-dim);
	}
</style>
