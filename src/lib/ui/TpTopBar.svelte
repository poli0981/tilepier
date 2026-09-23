<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '$lib/paraglide/messages';
	import { online } from '$lib/stores/online.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';

	/**
	 * doc 13 §1. 48 px, logo-mark and wordmark on the left, centre deliberately
	 * empty — calm is the point — and add / edit / settings / about on the right.
	 *
	 * The offline chip (doc 13 §7) sits left of centre rather than in the right
	 * cluster: it is state, not a control, and mixing the two invites a click.
	 */

	/**
	 * How far the page has to travel in one direction before the bar reacts.
	 * Enough to ignore a trackpad settling and the rubber-band at either end of
	 * a phone scroll; little enough to follow a deliberate flick.
	 */
	const SCROLL_SLOP = 8;

	let bar = $state<HTMLElement | null>(null);
	let scrolledAway = $state(false);
	let focusInside = $state(false);

	/**
	 * doc 13 §1: the bar hides on scroll-down and comes back on scroll-up —
	 * mostly a phone concern, since a desktop deck rarely scrolls.
	 *
	 * It never hides while it is the thing in use: in edit mode (the strip
	 * under it is sticky at the bar's height, and its Done button is how edit
	 * mode ends), while the drawer or the shortcuts sheet is open, or with focus
	 * inside it — a keyboard user tabbing into a bar they cannot see is exactly
	 * what WCAG 2.4.11 forbids. It hides with `transform` only, so the layout,
	 * the grid's geometry and the detail overlay's FLIP never see it move.
	 */
	const hidden = $derived(
		scrolledAway && !ui.editMode && !ui.drawerOpen && !ui.shortcutsOpen && !focusInside
	);

	$effect(() => {
		let lastY = window.scrollY;
		let frame = 0;

		function settle(): void {
			frame = 0;
			const y = window.scrollY;
			// Within the bar's own height of the top it is simply part of the page.
			if (y <= (bar?.offsetHeight ?? 0)) {
				scrolledAway = false;
				lastY = y;
				return;
			}
			const delta = y - lastY;
			if (Math.abs(delta) < SCROLL_SLOP) return;
			scrolledAway = delta > 0;
			lastY = y;
		}

		function onScroll(): void {
			if (frame === 0) frame = requestAnimationFrame(settle);
		}

		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			window.removeEventListener('scroll', onScroll);
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	});

	function onFocusOut(event: FocusEvent & { currentTarget: HTMLElement }): void {
		focusInside = event.currentTarget.contains(event.relatedTarget as Node | null);
	}
</script>

<header
	class="tp-bar"
	data-hidden={hidden}
	data-testid="top-bar"
	bind:this={bar}
	onfocusin={() => (focusInside = true)}
	onfocusout={onFocusOut}
>
	<div class="tp-bar__inner">
		<a class="tp-bar__brand" href={resolve('/')}>
			<TpTideGauge level={0.55} animated size={22} />
			<span class="tp-bar__wordmark">TilePier</span>
		</a>

		{#if !online.isOnline}
			<span class="tp-bar__chip" role="status" data-testid="offline-chip"
				>{m['common.offline.title']()}</span
			>
		{/if}

		<div class="tp-bar__spacer"></div>

		<nav class="tp-bar__actions">
			<button
				type="button"
				class="tp-bar__button"
				data-testid="open-drawer"
				aria-label={m['common.add_widget']()}
				onclick={() => ui.openDrawer()}
			>
				<TpIcon name="plus" size={18} />
			</button>

			<button
				type="button"
				class="tp-bar__button"
				data-testid="toggle-edit"
				aria-label={m['common.edit_mode']()}
				aria-pressed={ui.editMode}
				onclick={() => ui.toggleEdit()}
			>
				<TpIcon name="edit" size={18} />
			</button>

			<a class="tp-bar__button" href={resolve('/settings')} aria-label={m['settings.title']()}>
				<TpIcon name="settings" size={18} />
			</a>

			<a class="tp-bar__button" href={resolve('/about')} aria-label={m['about.title']()}>
				<TpIcon name="quote" size={18} />
			</a>
		</nav>
	</div>
</header>

{#if ui.editMode}
	<!-- doc 13 §2: a slim beacon strip under the bar names the mode. -->
	<div class="tp-bar__mode" data-testid="edit-strip">
		<div class="tp-bar__inner">
			<span>{m['common.editing']()}</span>
			<button type="button" onclick={() => ui.toggleEdit()}>{m['common.done']()}</button>
		</div>
	</div>
{/if}

<style>
	/* The bar's surface runs edge to edge; its content sits on the deck's own
	   rail — the same max-width and page padding as `main` — so the brand and
	   the grid share a left edge at every width (doc 13 §1, `e2e/top-bar`). */
	.tp-bar {
		position: sticky;
		top: 0;
		z-index: 50;
		height: var(--tp-bar-h);
		border-bottom: 1px solid var(--color-ink-700);
		background: var(--color-ink-950);
		transition: transform 160ms ease-out;
	}

	.tp-bar[data-hidden='true'] {
		transform: translateY(-100%);
	}

	/* doc 12 §7: the in-app reduced-motion setting, not only the OS one — the
	   global backstop in app.css covers the media query. */
	:global(html[data-motion='reduced']) .tp-bar {
		transition: none;
	}

	.tp-bar__inner {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: 100%;
		max-width: var(--tp-deck-max);
		margin: 0 auto;
		padding: 0 var(--tp-page-pad);
	}

	.tp-bar__brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-fg);
		text-decoration: none;
	}

	.tp-bar__wordmark {
		font-weight: 600;
		font-size: var(--text-base);
		letter-spacing: -0.01em;
	}

	/* doc 13 §7: a quiet amber chip, not an alarm. */
	.tp-bar__chip {
		border: 1px solid var(--color-warn);
		border-radius: var(--radius-ctl);
		padding: 0.125rem 0.5rem;
		color: var(--color-warn);
		font-size: var(--text-2xs);
	}

	.tp-bar__spacer {
		flex: 1 1 auto;
	}

	.tp-bar__actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.tp-bar__button {
		display: flex;
		align-items: center;
		justify-content: center;
		/* doc 13 §8: interactive targets are at least 40 px. */
		min-width: 40px;
		min-height: 40px;
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
	}

	.tp-bar__button:hover {
		color: var(--color-fg);
		background: var(--color-ink-900);
	}

	.tp-bar__button[aria-pressed='true'] {
		color: var(--color-beacon);
		background: var(--color-beacon-soft);
	}

	.tp-bar__mode {
		position: sticky;
		top: var(--tp-bar-h);
		z-index: 49;
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
		font-size: var(--text-2xs);
	}

	.tp-bar__mode .tp-bar__inner {
		justify-content: space-between;
		padding-block: 0.25rem;
	}

	.tp-bar__mode button {
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
		font: inherit;
		font-weight: 600;
		min-height: 24px;
		padding: 0 0.25rem;
	}
</style>
