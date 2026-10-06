<script lang="ts">
	import { LOCALES } from '$lib/i18n';
	import { REGISTER } from '$lib/legal/register';
	import generated from '$lib/legal/licenses.generated.json';
	import { m } from '$lib/paraglide/messages';

	/**
	 * doc 16 §5 in two halves. The register — what each source asks of us — is
	 * `$lib/legal/register.ts`, held to the doc by its test. Below it, every
	 * licence that ships, which `pnpm licenses:gen` writes from the build itself
	 * (scripts/licenses-gen.mjs explains the four places it looks).
	 *
	 * The register and the prose around the appendix render once per locale
	 * (doc 14 §6). The licence texts themselves are English data, about 150 KB of
	 * it, so they render once, after both — and `+page.ts` keeps the page from
	 * hydrating, so none of it becomes JavaScript.
	 */

	interface TpLicensedPackage {
		name: string;
		license: string;
		homepage: string;
		source?: string;
	}

	const licences: { packages: TpLicensedPackage[]; text: string }[] = generated.licences;
	const entries = licences.flatMap((group) => group.packages);

	/** Packages whose text was not a licence file, by where it came from. */
	function from(source: string): string {
		return entries
			.filter((entry) => entry.source === source)
			.map((entry) => entry.name)
			.join(', ');
	}

	const declared = from('declared');
	const assembled = [from('readme'), from('header')].filter((names) => names !== '').join(', ');
</script>

<svelte:head><title>{m['legal.licenses.page_title']()}</title></svelte:head>

{#each LOCALES as locale (locale)}
	<div data-locale={locale}>
		<h1>{m['legal.licenses.title'](undefined, { locale })}</h1>
		<p>{m['legal.licenses.intro'](undefined, { locale })}</p>

		<div class="tp-scroll">
			<table>
				<thead>
					<tr>
						<th>{m['legal.licenses.col_item'](undefined, { locale })}</th>
						<th>{m['legal.licenses.col_licence'](undefined, { locale })}</th>
						<th>{m['legal.licenses.col_obligation'](undefined, { locale })}</th>
					</tr>
				</thead>
				<!-- Absolute URLs to the sources and their licences, not routes of this app. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<tbody>
					{#each REGISTER as row (row.doc)}
						<tr>
							<td>
								{#if row.href === undefined}{row.item}{:else}<a
										href={row.href}
										rel="noopener noreferrer">{row.item}</a
									>{/if}
							</td>
							<td>
								{#if row.licenceHref === undefined}{row.licence}{:else}<a
										href={row.licenceHref}
										rel="noopener noreferrer">{row.licence}</a
									>{/if}
							</td>
							<td>{m[row.obligation](undefined, { locale })}</td>
						</tr>
					{/each}
				</tbody>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</table>
		</div>

		<h2>{m['legal.licenses.appendix_title'](undefined, { locale })}</h2>
		<p>
			{m['legal.licenses.appendix_intro']({ count: String(entries.length) }, { locale })}
		</p>
		{#if assembled !== ''}
			<p>{m['legal.licenses.appendix_assembled']({ names: assembled }, { locale })}</p>
		{/if}
		{#if declared !== ''}
			<p>{m['legal.licenses.appendix_declared']({ names: declared }, { locale })}</p>
		{/if}
	</div>
{/each}

<!-- licenses:gen insertion point — do not remove (doc 16 §5) -->
<div class="tp-appendix" data-testid="licence-appendix">
	{#each licences as group (group.text)}
		<details>
			<summary>
				<span class="tp-appendix__names">
					{group.packages.map((entry) => entry.name).join(' · ')}
				</span>
				<span class="tp-appendix__id">
					{[...new Set(group.packages.map((entry) => entry.license))].join(' · ')}
				</span>
			</summary>
			<p class="tp-appendix__links">
				<!-- Each package's own page, from its package.json; not a route of this app. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				{#each group.packages as entry (entry.name)}
					<a href={entry.homepage} rel="noopener noreferrer">{entry.name}</a>
				{/each}
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</p>
			<pre>{group.text}</pre>
		</details>
	{/each}
</div>

<style>
	.tp-appendix {
		margin: 0 0 1rem;
		border-top: 1px solid var(--color-ink-700);
	}

	.tp-appendix details {
		border-bottom: 1px solid var(--color-ink-700);
	}

	/* A summary is a control: 40 px tall like every control outside a tile
	   (doc 13 §8). */
	.tp-appendix summary {
		min-height: var(--tp-target);
		padding-block: 0.5rem;
		cursor: pointer;
		color: var(--color-fg);
		font-size: var(--text-xs);
	}

	.tp-appendix__id {
		margin-inline-start: 0.75em;
		color: var(--color-fg-dim);
	}

	.tp-appendix__links a {
		color: var(--color-beacon);
	}

	.tp-appendix__links a + a {
		margin-inline-start: 0.75em;
	}

	/* Wrapped rather than scrolled sideways: a licence is read top to bottom,
	   and a wrapped block needs no scroll region of its own (doc 13 §6). */
	.tp-appendix pre {
		margin: 0 0 1rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		color: var(--color-fg-mute);
	}
</style>
