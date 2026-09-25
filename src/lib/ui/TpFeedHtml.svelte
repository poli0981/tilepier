<script lang="ts">
	import { logEntry } from '$lib/core/log-buffer';

	/**
	 * The **second and last** `{@html}` in the application (doc 15 §4), and the
	 * RSS profile's only way onto a page.
	 *
	 * It takes the feed's summary *as the Worker delivered it* — unsanitised —
	 * never HTML somebody cleaned beforehand, for the reason `TpMarkdown` gives:
	 * a component that accepted clean HTML would be one careless call site away
	 * from rendering something that was not, and the `// SAFETY:` comment would
	 * sit on the render instead of on the decision. The pipeline is inside this
	 * boundary and cannot be skipped from outside it.
	 *
	 * **One profile, fixed.** Not a `TpMarkdown` with a profile prop: a prop that
	 * chooses the sanitiser is the flag `core/sanitize.ts` refuses to be, one
	 * wrong value from a stranger's HTML under the notes allowlist, `img` and all.
	 *
	 * `core/sanitize.ts` loads on demand, so DOMPurify stays in a lazy chunk
	 * shared with `TpMarkdown` rather than in the reader's own.
	 */
	interface Props {
		/** A feed item's `summaryHtml` — a stranger's HTML. */
		source: string;
		/** The feed's declared language (doc 14): `''` says "unknown" rather than
		 *  letting the page's language claim a stranger's text. */
		lang: string;
		label?: string | undefined;
	}

	let { source, lang, label }: Props = $props();

	type Sanitizer = typeof import('$lib/core/sanitize');

	let sanitizer = $state<Sanitizer | null>(null);

	$effect(() => {
		let cancelled = false;

		void import('$lib/core/sanitize')
			.then((module) => {
				if (!cancelled) sanitizer = module;
			})
			.catch((error: unknown) => {
				logEntry('error', 'feed sanitiser failed to load', { src: 'widget', error });
			});

		return () => {
			cancelled = true;
		};
	});

	const html = $derived(sanitizer === null ? '' : sanitizer.sanitizeRssHtml(source));
</script>

<!--
	SAFETY: `html` is only ever `sanitizeRssHtml(source)` (core/sanitize.ts) — the
	strict RSS allowlist of doc 15 §4, no `img`, links forced to
	`rel="noopener noreferrer" target="_blank"`, on a DOMPurify instance of its
	own — with the XSS corpus of doc 19 §3.6 behind it in
	`sanitize.svelte.test.ts`. Until the sanitiser has loaded it is the empty
	string. There is no prop, branch or other assignment that can put anything
	else here.
-->
<div
	class="tp-feed-html"
	{lang}
	aria-busy={sanitizer === null}
	aria-label={label}
	data-testid="feed-html"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>

<style>
	.tp-feed-html {
		color: var(--color-fg-mute);
		font-size: var(--text-base);
		line-height: 1.6;
		overflow-wrap: anywhere;
	}

	/* `:global` throughout, confined by `.tp-feed-html`: this subtree is written by
	   the sanitiser, which Svelte's scoping attribute never reaches. */
	.tp-feed-html :global(p) {
		margin: 0 0 0.75em;
	}

	.tp-feed-html :global(p:last-child) {
		margin-bottom: 0;
	}

	.tp-feed-html :global(a) {
		color: var(--color-beacon);
		text-underline-offset: 3px;
	}

	.tp-feed-html :global(strong),
	.tp-feed-html :global(b) {
		color: var(--color-fg);
	}

	.tp-feed-html :global(ul),
	.tp-feed-html :global(ol) {
		margin: 0 0 0.75em;
		padding-left: 1.25em;
	}

	.tp-feed-html :global(blockquote) {
		margin: 0 0 0.75em;
		border-left: 2px solid var(--color-ink-700);
		padding-left: 0.75em;
		color: var(--color-fg-dim);
	}

	.tp-feed-html :global(code) {
		border-radius: 4px;
		background: var(--color-ink-950);
		font-family: var(--font-mono);
		font-size: 0.92em;
		padding: 0.1em 0.3em;
	}

	.tp-feed-html :global(pre) {
		margin: 0 0 0.75em;
		overflow-x: auto;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		padding: 0.6em 0.75em;
	}

	.tp-feed-html :global(pre code) {
		background: none;
		padding: 0;
	}
</style>
