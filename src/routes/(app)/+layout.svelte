<script lang="ts">
	import { resolve } from '$app/paths';
	import { acceptLegal, hasAcceptedLegal } from '$lib/core/legal';

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
	Placeholder copy; the real bilingual texts are a Week 1 deliverable (doc 23).
-->
<div class="tp-gate" role="dialog" aria-modal="true" aria-labelledby="tp-gate-title">
	<div class="tp-gate__panel">
		<h1 id="tp-gate-title">TilePier</h1>
		<p>
			Bảng điều khiển cục bộ. Không tài khoản, không theo dõi, không cookie. Dữ liệu của bạn ở lại
			trên máy bạn.
		</p>
		<p class="tp-gate__links">
			<a href={resolve('/legal/terms')}>Điều khoản</a>
			<a href={resolve('/legal/privacy')}>Riêng tư</a>
			<a href={resolve('/legal/licenses')}>Giấy phép</a>
		</p>
		<button type="button" onclick={onAccept}>Tôi đồng ý</button>
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

	.tp-gate__panel button:hover {
		background: var(--color-beacon-deep);
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
