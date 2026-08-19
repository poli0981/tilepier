<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { acceptLegal, hasAcceptedLegal } from '$lib/core/legal';
	import { LOCALES } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	let { children } = $props();

	// Defence in depth for the gate. boot.js normally sets data-legal before
	// first paint, but it is a separate request that an extension, a proxy, or a
	// stale cache can drop. Re-checking on mount means a failed boot.js shows
	// the gate again rather than leaving the attribute — and any attribute set
	// by hand in devtools without a matching localStorage entry gets undone.
	$effect(() => {
		const root = document.documentElement;
		const accepted = hasAcceptedLegal();
		if (accepted) root.setAttribute('data-legal', 'ok');
		else root.removeAttribute('data-legal');
	});

	function onAccept() {
		acceptLegal();
	}
</script>

<!--
	Legal gate (doc 16 §2). Present in the prerendered HTML so it appears pre-JS;
	hidden by CSS once <html data-legal="ok"> is set — either by static/boot.js
	before first paint for a returning visitor, or by acceptLegal() on click.
	It wraps the deck only: /legal/* sits outside this group so the linked texts
	stay readable before acceptance.

	Both locales are rendered and CSS hides the wrong one (doc 14 §6). The page
	is prerendered to a single HTML file and the locale lives in localStorage,
	so the markup cannot be locale-specific; boot.js sets <html lang> before
	first paint, which is what picks. The language links are a pair rather than
	a button so they work before hydration.
-->
<div class="tp-gate" role="dialog" aria-modal="true" aria-labelledby="tp-gate-title">
	<div class="tp-gate__panel">
		<h1 id="tp-gate-title">TilePier</h1>

		{#each LOCALES as locale (locale)}
			<div data-locale={locale}>
				<p>{m['legal.gate.summary'](undefined, { locale })}</p>
				<p class="tp-gate__links">
					<a href={resolve('/legal/terms')}>{m['legal.terms.title'](undefined, { locale })}</a>
					<a href={resolve('/legal/privacy')}>{m['legal.privacy.title'](undefined, { locale })}</a>
					<a href={resolve('/legal/licenses')}>{m['legal.licenses.title'](undefined, { locale })}</a
					>
					<a href={resolve('/about')}>{m['about.title'](undefined, { locale })}</a>
				</p>
				<!--
					The gate is in the prerendered HTML so it appears pre-JS (doc 16 §2),
					but accepting needs a click handler. `browser` is false in the
					prerendered markup and true in the client bundle, so the button is
					pressable exactly when pressing it does something. Leaving it
					enabled meant a consent button that silently ignored the first
					click — the wrong affordance on this screen of all screens, and a
					race every e2e run had to work around.
				-->
				<button type="button" onclick={onAccept} disabled={!browser} data-testid="gate-accept">
					{m['legal.gate.accept'](undefined, { locale })}
				</button>
			</div>
		{/each}

		<!-- Language names are not translated, so they render once. -->
		<p class="tp-gate__lang">
			<!-- The path *is* resolved; the rule's heuristic cannot see resolve()
			     through a template literal, and the query is what carries the
			     choice (doc 14 §6). -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a href={`${resolve('/')}?lang=vi`} hreflang="vi">Tiếng Việt</a>
			<a href={`${resolve('/')}?lang=en`} hreflang="en">English</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</p>
	</div>
</div>

<div class="tp-app">
	{@render children()}
</div>

<style>
	/* The gate is the default state; acceptance removes it. Failing closed means
	   a broken stylesheet or a blocked boot.js leaves the gate up, not down. */
	.tp-gate {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		padding: 1.5rem;
		background: var(--color-ink-950);
	}

	.tp-gate__panel {
		max-width: 34rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-900);
		padding: 2rem;
		box-shadow: var(--shadow-tile);
	}

	.tp-gate__panel h1 {
		margin: 0 0 0.75rem;
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.tp-gate__panel p {
		margin: 0 0 1rem;
		color: var(--color-fg-mute);
		font-size: var(--text-base);
	}

	.tp-gate__links {
		display: flex;
		gap: 1rem;
	}

	.tp-gate__links a {
		color: var(--color-fg-mute);
		text-decoration-color: var(--color-ink-500);
		text-underline-offset: 3px;
	}

	.tp-gate__links a:hover {
		color: var(--color-beacon);
	}

	.tp-gate__panel button {
		margin-top: 0.5rem;
		border: 0;
		border-radius: var(--radius-ctl);
		background: var(--color-beacon);
		color: var(--color-ink-950);
		font: inherit;
		font-weight: 600;
		padding: 0.6rem 1.1rem;
		cursor: pointer;
		min-height: 40px; /* doc 13 §8: touch targets ≥ 40 px */
	}

	.tp-gate__panel button:hover:not(:disabled) {
		background: var(--color-beacon-deep);
	}

	.tp-gate__panel button:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.tp-gate__lang {
		display: flex;
		gap: 1rem;
		margin: 1.25rem 0 0;
		border-top: 1px solid var(--color-ink-700);
		padding-top: 1rem;
		font-size: var(--text-xs);
	}

	.tp-gate__lang a {
		color: var(--color-fg-dim);
		text-underline-offset: 3px;
	}

	.tp-gate__lang a:hover {
		color: var(--color-beacon);
	}

	:global(html[data-legal='ok']) .tp-gate {
		display: none;
	}

	/* The deck stays inert until the gate clears — this is the "not dismissible
	   by DOM deletion alone" half of doc 16 §2, paired with the store not
	   hydrating until the flag exists. */
	.tp-app {
		display: none;
	}

	:global(html[data-legal='ok']) .tp-app {
		display: block;
	}
</style>
