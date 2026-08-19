<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '$lib/paraglide/messages';
	import TpBugDialog from '$lib/ui/TpBugDialog.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';

	/**
	 * doc 17 §1. One file for both cases, branching on status, and deliberately
	 * at the route root rather than inside `(app)` — an error page has to render
	 * even for a visitor who has not passed the legal gate.
	 *
	 * 404 gets the tide-gauge and a way home. 500 additionally shows the
	 * correlation id from `handleError` and opens the bug flow with it attached,
	 * which is the only reason the id exists.
	 */
	let bugOpen = $state(false);

	const notFound = $derived(page.status === 404);
	const errorId = $derived(page.error?.id);
</script>

<svelte:head>
	<title>{notFound ? m['error.not_found.title']() : m['error.crashed.title']()}</title>
</svelte:head>

<main>
	<TpTideGauge level={notFound ? 0.15 : 0.35} size={40} />

	<h1>{notFound ? m['error.not_found.title']() : m['error.crashed.title']()}</h1>
	<p>{notFound ? m['error.not_found.body']() : m['error.crashed.body']()}</p>

	{#if !notFound && errorId !== undefined}
		<p class="tp-id tp-num" data-testid="error-id">{errorId}</p>
	{/if}

	<p class="tp-actions">
		<a href={resolve('/')}>{m['common.back_to_deck']()}</a>
		{#if !notFound}
			<button type="button" data-testid="error-report" onclick={() => (bugOpen = true)}>
				{m['settings.report.open']()}
			</button>
		{/if}
	</p>
</main>

<TpBugDialog open={bugOpen} {errorId} onClose={() => (bugOpen = false)} />

<style>
	main {
		display: flex;
		max-width: 34rem;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
		margin: 0 auto;
		padding: 5rem 1.5rem;
		color: var(--color-fg-mute);
	}

	h1 {
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-lg);
		font-weight: 600;
	}

	p {
		margin: 0;
	}

	.tp-id {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
	}

	.tp-actions a {
		color: var(--color-beacon);
	}

	.tp-actions button {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		min-height: 36px;
		padding: 0 0.75rem;
	}
</style>
