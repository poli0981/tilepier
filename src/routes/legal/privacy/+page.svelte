<script lang="ts">
	import { LOCALES } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	/**
	 * The human-readable form of doc 16 §3, in the order that document sets.
	 * Six points, no preamble about "your privacy matters to us" — the claim is
	 * either true of the code or it is not, and doc 16 §3 is what makes it true.
	 *
	 * Both locales render; CSS on <html lang> picks (doc 14 §6).
	 */
	const POINTS = [
		'legal.privacy.no_tracking',
		'legal.privacy.local_only',
		'legal.privacy.proxy',
		'legal.privacy.coordinates',
		'legal.privacy.bug_reports',
		'legal.privacy.deletion'
	] as const;
</script>

<svelte:head><title>{m['legal.privacy.page_title']()}</title></svelte:head>

{#each LOCALES as locale (locale)}
	<div data-locale={locale}>
		<h1>{m['legal.privacy.title'](undefined, { locale })}</h1>
		<p>{m['legal.privacy.intro'](undefined, { locale })}</p>

		<ol>
			{#each POINTS as key (key)}
				<li>{m[key](undefined, { locale })}</li>
			{/each}
		</ol>
	</div>
{/each}
