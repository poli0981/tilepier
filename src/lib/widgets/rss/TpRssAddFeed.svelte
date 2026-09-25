<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { refusalText } from './labels';
	import { addFeed, type TpFeedRefusal } from './service';

	/**
	 * The box a feed URL is pasted into — the tile's empty state and the
	 * detail's feed manager both, so the two cannot disagree about what a
	 * feed URL may be or how a refusal reads.
	 *
	 * The rules are `addFeed`'s, which are doc 15 §5's through `parseFeedUrl`:
	 * the same function the Worker runs, so a URL this box accepts is one the
	 * Worker will answer for, and a URL it refuses says which rule it broke
	 * before anything is sent.
	 */
	interface Props {
		feeds: readonly string[];
		/** The list with the new feed on the end, canonical. */
		onAdd: (feeds: string[]) => void;
		/** Unique per mount: the refusal line is tied to the field by id. */
		id: string;
	}

	let { feeds, onAdd, id }: Props = $props();

	let draft = $state('');
	let refusal = $state<TpFeedRefusal | null>(null);

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		// The Worker refuses a feed on the host it answers on, and saying so here
		// puts the reason in the box rather than in a chip after a round trip.
		const edit = addFeed(feeds, draft, location.hostname);
		if (!edit.ok) {
			refusal = edit.reason;
			return;
		}
		refusal = null;
		draft = '';
		onAdd(edit.feeds);
	}
</script>

<!-- `novalidate`: a bare `example.com/feed` is fine here — `feedInput` gives it
     its scheme — and the browser's own url check would refuse it first. -->
<form class="tp-rss-addf" onsubmit={submit} novalidate>
	<label class="tp-rss-addf__field">
		<TpIcon name="rss" size={14} />
		<input
			type="url"
			bind:value={draft}
			oninput={() => (refusal = null)}
			placeholder={m['widget.rss.add_placeholder']()}
			aria-label={m['widget.rss.add_label']()}
			aria-invalid={refusal !== null}
			aria-describedby={refusal === null ? undefined : `${id}-refusal`}
			autocomplete="off"
			spellcheck="false"
			data-testid="rss-add-input"
		/>
	</label>
	<button type="submit" class="tp-rss-addf__submit" data-testid="rss-add">
		<TpIcon name="plus" size={13} />
		{m['widget.rss.add']()}
	</button>
	{#if refusal !== null}
		<p class="tp-rss-addf__refusal" id="{id}-refusal" role="alert">{refusalText(refusal)}</p>
	{/if}
</form>

<style>
	.tp-rss-addf {
		display: flex;
		width: 100%;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.tp-rss-addf__field {
		display: flex;
		min-width: 0;
		flex: 1 1 12rem;
		align-items: center;
		gap: 0.375rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		padding: 0 0.5rem;
		color: var(--color-fg-dim);
	}

	.tp-rss-addf__field:focus-within {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	.tp-rss-addf__field input {
		min-width: 0;
		flex: 1 1 auto;
		border: 0;
		background: none;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-2xs);
		padding: 0.3rem 0;
	}

	.tp-rss-addf__field input:focus {
		outline: none;
	}

	.tp-rss-addf__submit {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0.125rem 0;
	}

	.tp-rss-addf__submit:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 2px;
	}

	.tp-rss-addf__refusal {
		flex: 1 0 100%;
		margin: 0;
		color: var(--color-danger);
		font-size: var(--text-2xs);
	}
</style>
