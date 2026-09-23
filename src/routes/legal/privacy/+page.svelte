<script lang="ts">
	import { LOCALES } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	/**
	 * The human-readable form of doc 16 §3, in the order that document sets.
	 * No preamble about "your privacy matters to us" — the claim is either true
	 * of the code or it is not, and doc 16 §3 is what makes it true.
	 *
	 * Eight points since LEGAL_VERSION 2 (2026-09-23): the two Cloudflare
	 * services that see a visit — Web Analytics and the Turnstile bot check —
	 * each get their own, saying what they receive, and the proxy's point says
	 * what Cloudflare's request logs keep. Their own terms are linked, because a
	 * summary of someone else's policy is not a substitute for it.
	 *
	 * Both locales render; CSS on <html lang> picks (doc 14 §6).
	 */
	const POINTS = [
		'legal.privacy.no_tracking',
		'legal.privacy.local_only',
		'legal.privacy.proxy',
		'legal.privacy.analytics',
		'legal.privacy.botcheck',
		'legal.privacy.coordinates',
		'legal.privacy.bug_reports',
		'legal.privacy.deletion'
	] as const;

	const CLOUDFLARE_PRIVACY = 'https://www.cloudflare.com/privacypolicy/';
	const TURNSTILE_PRIVACY = 'https://www.cloudflare.com/turnstile-privacy-policy/';
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

		<p>
			{m['legal.privacy.cloudflare_lead'](undefined, { locale })}
			<a href={CLOUDFLARE_PRIVACY} rel="noopener noreferrer" target="_blank"
				>{m['legal.privacy.cloudflare_policy'](undefined, { locale })}</a
			>
			·
			<a href={TURNSTILE_PRIVACY} rel="noopener noreferrer" target="_blank"
				>{m['legal.privacy.turnstile_policy'](undefined, { locale })}</a
			>
		</p>
	</div>
{/each}
