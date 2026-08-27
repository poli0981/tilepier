<script lang="ts">
	import { untrack, type Component } from 'svelte';
	import { forgetDetailComponent, loadDetailComponent, type TpDetailState } from '$lib/core/detail';
	import type { TpDetailProps } from '$lib/core/types';
	import { widgetLabels } from '$lib/i18n/widget-labels';
	import { m } from '$lib/paraglide/messages';
	import { deck } from '$lib/stores/deck.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';

	/**
	 * The expanded detail panel (doc 13 §5), mounted over the deck.
	 *
	 * Open/closed lives in `page.state`, not here — the deck page renders this
	 * component only while that state exists, and closing means popping the
	 * history entry. See `core/detail.ts` for why history owns it.
	 *
	 * **The exit animation only plays on a close the user asked us for** — the
	 * ×, Esc, or the scrim. Browser Back changes `page.state` before anything
	 * here can react, so the panel is simply gone. That is the browser's own
	 * behaviour for Back, and buying a reverse FLIP for it would mean holding a
	 * shadow copy of the state past its history entry, which is a second source
	 * of truth for exactly one frame of animation.
	 */
	interface Props {
		/**
		 * Named `detail`, not `target`: `target` is a reserved option of Svelte's
		 * own `mount`/`render`, so a component test cannot pass it as a prop
		 * without nesting everything under `props: {}`. Worth knowing before the
		 * next component reaches for the same obvious word.
		 */
		detail: TpDetailState;
		/** The tile's rect *now* — doc 13 §5.3 recomputes on close, because the
		 *  grid may have reflowed while the panel was open. Supplied by the deck
		 *  page, which is the only thing that knows where the grid is. */
		rectOf?: ((instanceId: string) => DOMRect | null) | undefined;
		onClose: () => void;
	}

	let { detail, rectOf, onClose }: Props = $props();

	/** doc 13 §5.1 / doc 12 §7. Transform and opacity only — never width or top,
	 *  which would lay out sixty times during the animation. */
	const SPRING_MS = 260;
	const REDUCED_MS = 120;
	/** Settles rather than overshoots; a real spring would need a JS ticker for
	 *  a curve nobody can pick out of a 260 ms move. */
	const SPRING_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

	let panelEl = $state<HTMLElement | null>(null);
	let component = $state<Component<TpDetailProps> | null>(null);
	let failed = $state(false);
	let closing = $state(false);
	/**
	 * Guards against a stale import winning a race. Two loads can be in flight if
	 * the panel is retried while the first is still pending, or if `detail`
	 * changes underneath it; only the newest may write to `component`. A counter
	 * rather than the effect's own cleanup, because `retry()` starts a load from
	 * outside any effect.
	 */
	let loadToken = 0;

	const tile = $derived(deck.tiles.find((entry) => entry.instanceId === detail.instanceId));

	let trigger: Element | null = null;

	/**
	 * Starts a load of the widget's detail chunk. Code, not data — doc 20 §3's
	 * ban is on fetching *data* in an effect, and doc 13 §5.2 puts this import
	 * squarely inside the opening animation with the skeleton standing in.
	 */
	function load(): void {
		const widgetId = detail.widgetId;
		const token = ++loadToken;

		failed = false;
		component = null;

		loadDetailComponent(widgetId)
			.then((loaded) => {
				if (token === loadToken) component = loaded;
			})
			.catch(() => {
				if (token === loadToken) failed = true;
			});
	}

	$effect(() => {
		// Depends on `detail.widgetId`, which `load()` reads — no bare expression
		// needed to establish it, and no counter to re-trigger it, because retry
		// calls the same function directly.
		load();
	});

	$effect(() => {
		// Owns the focus contract of doc 13 §8: the panel is a dialog, focus goes
		// into it on open and back to the tile that opened it on close.
		trigger = document.activeElement;
		panelEl?.focus();

		return () => {
			if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
		};
	});

	$effect(() => {
		// Plays the opening FLIP once the panel has a box to measure.
		const panel = panelEl;
		if (panel === null) return;

		// Untracked for the reason doc 06 §5 rule 7 gives: `flip()` reads
		// `settings.motionOK` and `detail.rect`, and this effect must depend on
		// the element alone. Tracked, toggling reduced motion in another tab
		// would replay the opening animation of an already-open panel.
		const animation = untrack(() => flip(panel, 'in'));
		return () => animation?.cancel();
	});

	/**
	 * Maps the panel between its laid-out position and the tile's rect.
	 *
	 * `transformOrigin: top left` is what makes the four numbers enough: with any
	 * other origin the translation would have to account for the scale about the
	 * centre, and the arithmetic stops being readable.
	 */
	function flip(panel: HTMLElement, direction: 'in' | 'out'): Animation | null {
		const reduced = !settings.motionOK;
		const from = direction === 'in' ? detail.rect : (rectOf?.(detail.instanceId) ?? detail.rect);

		// doc 13 §5.5: reduced motion crossfades instead, and a deep-linked panel
		// with no tile rect has nothing to fly from, so it crossfades too.
		if (reduced || from === undefined || from === null) {
			return panel.animate([{ opacity: 0 }, { opacity: 1 }], {
				duration: REDUCED_MS,
				direction: direction === 'in' ? 'normal' : 'reverse'
			});
		}

		const to = panel.getBoundingClientRect();
		if (to.width === 0 || to.height === 0) return null;

		const frames: Keyframe[] = [
			{
				transformOrigin: 'top left',
				transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`,
				opacity: 0.4
			},
			{ transformOrigin: 'top left', transform: 'none', opacity: 1 }
		];

		return panel.animate(direction === 'in' ? frames : [...frames].reverse(), {
			duration: SPRING_MS,
			easing: SPRING_EASE,
			fill: 'both'
		});
	}

	async function requestClose(): Promise<void> {
		if (closing) return;
		closing = true;

		const panel = panelEl;
		const animation = panel === null ? null : flip(panel, 'out');
		if (animation !== null) {
			// A cancelled animation rejects; the panel is going away either way.
			await animation.finished.catch(() => undefined);
		}
		onClose();
	}

	function retry(): void {
		// The cache remembers failures on purpose (core/detail.ts); this is the
		// explicit way past it.
		forgetDetailComponent(detail.widgetId);
		load();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		// doc 13 §8: Esc closes the topmost layer, and while this is open it is
		// the topmost one. Stopping propagation keeps the layout's global handler
		// from also dropping out of edit mode on the same keystroke.
		event.stopPropagation();
		void requestClose();
	}

	function onUpdateSettings(partial: Record<string, unknown>): void {
		deck.updateSettings(detail.instanceId, partial);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- doc 13 §5.1: scrim is ink-950 at 80 %. Presentation role — the dialog below
     is the thing screen readers should see, and Esc is handled above. -->
<div
	class="tp-detail__scrim"
	class:closing
	role="presentation"
	data-testid="detail-scrim"
	onclick={() => void requestClose()}
></div>

<div
	class="tp-detail"
	role="dialog"
	aria-modal="true"
	aria-labelledby="tp-detail-title"
	tabindex="-1"
	bind:this={panelEl}
	data-testid="detail-panel"
	data-widget={detail.widgetId}
>
	<header>
		<!-- Named from the widget's own title so the dialog has an accessible name
		     before its chunk has arrived. Through `widgetLabels` rather than a
		     computed `m[...]` key: doc 06 §1 puts the message references in one
		     record precisely so a lookup by id stays typed. -->
		<h2 id="tp-detail-title">{widgetLabels(detail.widgetId)?.title() ?? detail.widgetId}</h2>
		<button
			type="button"
			class="tp-detail__close"
			aria-label={m['common.dismiss']()}
			data-testid="detail-close"
			onclick={() => void requestClose()}
		>
			<TpIcon name="close" size={18} />
		</button>
	</header>

	<div class="tp-detail__body">
		{#if failed}
			<!-- doc 17 §6: inline, never a blank panel, and always a way forward. -->
			<div class="tp-detail__state" role="alert">
				<p>{m['common.detail.failed']()}</p>
				<button type="button" class="tp-detail__retry" onclick={retry}>
					{m['common.retry']()}
				</button>
			</div>
		{:else if component !== null && tile !== undefined}
			{@const Detail = component}
			<Detail
				instanceId={detail.instanceId}
				settings={tile.settings}
				{onUpdateSettings}
				close={() => void requestClose()}
			/>
		{:else if tile === undefined}
			<!-- The tile went away underneath the panel — removed in another tab,
			     or the deck was reset while this was open. -->
			<div class="tp-detail__state">
				<p>{m['common.detail.gone']()}</p>
			</div>
		{:else}
			<!-- doc 13 §7: skeleton, never a spinner. The motion masks the load. -->
			<div class="tp-detail__state" aria-busy="true" aria-label={m['common.detail.loading']()}>
				<TpTideGauge size={48} animated level={0.35} />
			</div>
		{/if}
	</div>
</div>

<style>
	.tp-detail__scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: color-mix(in srgb, var(--color-ink-950) 80%, transparent);
		opacity: 1;
		transition: opacity 160ms ease-out;
	}

	/* Fades with the panel's exit rather than vanishing a frame before it. */
	.tp-detail__scrim.closing {
		opacity: 0;
	}

	:global(html[data-motion='reduced']) .tp-detail__scrim {
		transition: none;
	}

	.tp-detail {
		position: fixed;
		z-index: 91;
		top: 50%;
		left: 50%;
		translate: -50% -50%;
		display: flex;
		flex-direction: column;
		width: min(1120px, calc(100vw - 2rem));
		height: min(86vh, calc(100dvh - 2rem));
		overflow: hidden;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-850);
		box-shadow: var(--shadow-tile);
	}

	/* doc 12 §5: the detail's left edge carries a faint tick rail. */
	.tp-detail::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 2px;
		background: repeating-linear-gradient(
			to bottom,
			var(--color-ink-700) 0 6px,
			transparent 6px 16px
		);
	}

	.tp-detail:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 2px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex: 0 0 auto;
		border-bottom: 1px solid var(--color-ink-700);
		padding: 0.75rem 1rem;
	}

	h2 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
	}

	.tp-detail__close {
		display: flex;
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		line-height: 1;
		/* doc 13 §8: interactive targets ≥ 40 px. */
		min-width: 40px;
		min-height: 40px;
		align-items: center;
		justify-content: center;
	}

	.tp-detail__close:hover {
		color: var(--color-fg);
	}

	.tp-detail__body {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding: 1rem;
	}

	.tp-detail__state {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-detail__state p {
		margin: 0;
	}

	.tp-detail__retry {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 40px;
		padding: 0 0.75rem;
	}

	/* doc 13 §6: full-screen sheet on small viewports. */
	@media (max-width: 767px) {
		.tp-detail {
			top: 0;
			left: 0;
			translate: none;
			width: 100vw;
			height: 100dvh;
			border: 0;
			border-radius: 0;
		}
	}
</style>
