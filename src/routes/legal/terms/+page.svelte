<script lang="ts">
	import { LOCALES } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	/**
	 * doc 16 §4. Short, plain-language, and deliberately only four points — the
	 * product takes no payments, holds no accounts, and hosts no user content,
	 * so there is very little to say and saying more would be theatre.
	 *
	 * Both locales render; CSS on <html lang> picks (doc 14 §6).
	 */
</script>

<svelte:head><title>{m['legal.terms.page_title']()}</title></svelte:head>

{#each LOCALES as locale (locale)}
	<div data-locale={locale}>
		<h1>{m['legal.terms.title'](undefined, { locale })}</h1>
		<p>{m['legal.terms.intro'](undefined, { locale })}</p>

		<h2>{m['legal.terms.no_warranty.head'](undefined, { locale })}</h2>
		<p>{m['legal.terms.no_warranty.body'](undefined, { locale })}</p>

		<h2>{m['legal.terms.personal_use.head'](undefined, { locale })}</h2>
		<p>{m['legal.terms.personal_use.body'](undefined, { locale })}</p>

		<h2>{m['legal.terms.fair_use.head'](undefined, { locale })}</h2>
		<p>{m['legal.terms.fair_use.body'](undefined, { locale })}</p>

		<h2>{m['legal.terms.discontinue.head'](undefined, { locale })}</h2>
		<p>{m['legal.terms.discontinue.body'](undefined, { locale })}</p>

		<p>{m['legal.terms.licence_note'](undefined, { locale })}</p>
	</div>
{/each}
