<script lang="ts">
	import { logEntry } from '$lib/core/log-buffer';

	/**
	 * The **only** `{@html}` in the application.
	 *
	 * It takes markdown *source*, never HTML. That is the point: a component
	 * that accepted HTML would be one careless call site away from rendering
	 * something unsanitised, and the `// SAFETY:` comment CLAUDE.md rule 7
	 * requires would be attached to the wrong place — to the render rather than
	 * to the decision. Here the pipeline is inside the boundary and cannot be
	 * skipped from outside it.
	 *
	 * `core/markdown.ts` is loaded on demand, so `marked` and `dompurify` form
	 * one lazy chunk shared by every consumer rather than sitting in a widget
	 * tile's 40 KB budget (doc 20 §6).
	 */
	interface Props {
		source: string;
		/** doc 12 §5's shimmer belongs to the caller; this renders nothing until
		 *  the pipeline has arrived, and says so through `aria-busy`. */
		label?: string | undefined;
	}

	let { source, label }: Props = $props();

	type Pipeline = typeof import('$lib/core/markdown');

	let pipeline = $state<Pipeline | null>(null);
	let html = $state('');

	$effect(() => {
		// Loads the renderer once per mount; the module cache makes every mount
		// after the first synchronous in practice.
		let cancelled = false;

		void import('$lib/core/markdown')
			.then((module) => {
				if (!cancelled) pipeline = module;
			})
			.catch((error: unknown) => {
				logEntry('error', 'markdown pipeline failed to load', { src: 'widget', error });
			});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		// Renders, debounced past the size where a synchronous parse per
		// keystroke is felt (doc 07 §4).
		const module = pipeline;
		const text = source;
		if (module === null) return;

		if (text.length < module.LARGE_SOURCE_CHARS) {
			html = module.renderMarkdown(text);
			return;
		}

		const id = setTimeout(() => (html = module.renderMarkdown(text)), module.SLOW_PREVIEW_MS);
		return () => clearTimeout(id);
	});
</script>

<!--
	SAFETY: `html` is only ever assigned the return value of `renderMarkdown`
	(core/markdown.ts), which is `marked` followed by `sanitizeNoteHtml`
	(core/sanitize.ts) — the allowlist doc 15 §4 specifies, with the XSS corpus
	of doc 19 §3.6 behind it in `sanitize.svelte.test.ts`. There is no prop, no
	branch and no other assignment that can put anything else here.
-->
<div class="tp-md" aria-busy={pipeline === null} aria-label={label} data-testid="markdown">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>

<style>
	.tp-md {
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	/* `:global` throughout: this subtree is written by the sanitiser, so Svelte's
	   scoping attribute never reaches it. The selectors are confined by `.tp-md`
	   instead, which is the same guarantee by a different route. */
	.tp-md :global(h1),
	.tp-md :global(h2),
	.tp-md :global(h3),
	.tp-md :global(h4),
	.tp-md :global(h5),
	.tp-md :global(h6) {
		margin: 0.75em 0 0.35em;
		color: var(--color-fg);
		font-size: var(--text-base);
		font-weight: 600;
	}

	.tp-md :global(h1:first-child),
	.tp-md :global(h2:first-child),
	.tp-md :global(h3:first-child) {
		margin-top: 0;
	}

	.tp-md :global(p) {
		margin: 0 0 0.6em;
	}

	.tp-md :global(p:last-child) {
		margin-bottom: 0;
	}

	.tp-md :global(a) {
		color: var(--color-beacon);
		text-underline-offset: 3px;
	}

	.tp-md :global(strong) {
		color: var(--color-fg);
	}

	.tp-md :global(del) {
		color: var(--color-fg-dim);
	}

	.tp-md :global(ul),
	.tp-md :global(ol) {
		margin: 0 0 0.6em;
		padding-left: 1.25em;
	}

	.tp-md :global(li) {
		margin: 0.15em 0;
	}

	.tp-md :global(code) {
		border-radius: 4px;
		background: var(--color-ink-950);
		font-family: var(--font-mono);
		font-size: 0.92em;
		padding: 0.1em 0.3em;
	}

	.tp-md :global(pre) {
		margin: 0 0 0.6em;
		overflow-x: auto;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		padding: 0.6em 0.75em;
	}

	.tp-md :global(pre code) {
		background: none;
		padding: 0;
	}

	.tp-md :global(blockquote) {
		margin: 0 0 0.6em;
		border-left: 2px solid var(--color-ink-700);
		padding-left: 0.75em;
		color: var(--color-fg-dim);
	}

	.tp-md :global(hr) {
		border: 0;
		border-top: 1px solid var(--color-ink-700);
		margin: 0.9em 0;
	}

	/* Wide content scrolls inside its own box rather than widening the tile. */
	.tp-md :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		margin: 0 0 0.6em;
	}

	.tp-md :global(th),
	.tp-md :global(td) {
		border: 1px solid var(--color-ink-700);
		padding: 0.25em 0.5em;
		text-align: left;
	}

	.tp-md :global(th) {
		color: var(--color-fg);
		font-weight: 600;
	}

	.tp-md :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: var(--radius-ctl);
	}

	/* GFM task lists. The boxes are disabled by the sanitiser — the source text
	   is the source of truth — so they are shown as read-only marks. */
	.tp-md :global(input[type='checkbox']) {
		margin-right: 0.35em;
		accent-color: var(--color-beacon);
	}
</style>
