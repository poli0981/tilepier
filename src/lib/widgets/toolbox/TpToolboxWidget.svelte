<script lang="ts">
	import type { TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import { parseHex, toHex } from './color';
	import { entropyBits, generatePassword, PASSWORD_DEFAULTS } from './password';
	import { drawQr, qrMatrix, QR_QUIET_ZONE, type TpQrMatrix } from './qr';
	import { pushRecentColor, readSettings } from './service';
	import { TOOLBOX_TABS, type TpToolboxTab } from './types';

	/**
	 * doc 07 §7 — the tile: the last-used tab, in compact form. The detail shows
	 * all three full width.
	 *
	 * Each compact form is the *useful* half of its tool rather than a preview of
	 * it: type and get a QR, press once and get a password, pick and copy a
	 * colour. A tile that could only say "open the detail to use this" would be
	 * three tabs of nothing.
	 *
	 * **States (doc 06 §3, pure-client class).** `stale`, `stale-error` and
	 * `offline` do not apply — nothing here touches the network, which is rather
	 * the point of a local QR encoder. `empty` is reachable and implemented: a QR
	 * tab with nothing typed, and a password tab before the first press.
	 * `loading` is unreachable — the panels are on screen immediately and the
	 * encoder loads behind an already-rendered empty state. `error` is inline:
	 * text that will not fit a QR, and a colour field that is not a colour yet.
	 */
	let { settings: tileSettings, size, onUpdateSettings }: TpWidgetProps = $props();

	const prefs = $derived(readSettings(tileSettings));

	/* ── qr ── */
	let qrText = $state('');
	let matrix = $state<TpQrMatrix | null>(null);
	let qrOverflow = $state(false);
	let canvas = $state<HTMLCanvasElement | null>(null);

	/* ── password ── */
	let password = $state('');
	const bits = $derived(entropyBits(PASSWORD_DEFAULTS));

	/* ── colour ── */
	// doc 20 §1's `tokens-audit-ignore`, for the same reason the settings
	// panel's accent swatches use it: this is user-selectable *data*, not
	// styling. It happens to be the beacon, so the tool opens on something
	// worth looking at — and `color.test.ts` asserts the token values, so the
	// duplication cannot drift unnoticed.
	// tokens-audit-ignore
	let colorInput = $state('#46d5c8');
	const rgb = $derived(parseHex(colorInput));

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	function setTab(tab: TpToolboxTab): void {
		onUpdateSettings?.({ tab });
	}

	async function copy(value: string): Promise<void> {
		if (value === '') return;
		await navigator.clipboard.writeText(value);
		copied = true;
		if (copyTimer !== null) clearTimeout(copyTimer);
		// doc 13 §7: a copy is micro-feedback, not a toast.
		copyTimer = setTimeout(() => (copied = false), 1400);
	}

	$effect(() => {
		// Clears the copy indicator's timer with the tile, so a removed widget
		// cannot write to state that is gone.
		return () => {
			if (copyTimer !== null) clearTimeout(copyTimer);
		};
	});

	$effect(() => {
		// Encodes whatever is typed. The encoder itself arrives through
		// `await import()` inside `qrMatrix`, so a deck that never opens this tab
		// never loads it (doc 20 §7).
		if (prefs.tab !== 'qr') return;

		const text = qrText;
		let cancelled = false;

		void qrMatrix(text, 'M').then((next) => {
			if (cancelled) return;
			matrix = next;
			// `null` means two different things and the tile says which: nothing
			// typed is `empty`, and text that will not fit is `error`.
			qrOverflow = next === null && text !== '';
		});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		// Paints the matrix. Split from the encoding above so that a resize
		// repaints without re-encoding.
		const element = canvas;
		const current = matrix;
		if (element === null || current === null) return;

		const available = Math.min(size.pxW, size.pxH) - 8;
		const scale = Math.max(1, Math.floor(available / (current.size + QR_QUIET_ZONE * 2)));
		drawQr(element, current, {
			scale,
			margin: QR_QUIET_ZONE,
			// Always dark-on-light regardless of theme: a scanner reads contrast,
			// and an inverted QR fails on about half of them.
			dark: '#000000', // tokens-audit-ignore — a QR is not themed, it is scanned
			light: '#ffffff' // tokens-audit-ignore
		});
	});

	function pick(value: string): void {
		colorInput = value;
		const parsed = parseHex(value);
		if (parsed === null) return;
		onUpdateSettings?.({ recentColors: pushRecentColor(prefs.recentColors, toHex(parsed)) });
	}
</script>

<div class="tp-tb" data-tier={size.tier}>
	<div class="tp-tb__tabs" role="tablist" aria-label={m['widget.toolbox.title']()}>
		{#each TOOLBOX_TABS as tab (tab)}
			<button
				type="button"
				role="tab"
				aria-selected={prefs.tab === tab}
				data-testid="tab-{tab}"
				onclick={() => setTab(tab)}
			>
				{tab === 'qr'
					? m['widget.toolbox.tab.qr']()
					: tab === 'password'
						? m['widget.toolbox.tab.password']()
						: m['widget.toolbox.tab.color']()}
			</button>
		{/each}
	</div>

	<div class="tp-tb__panel">
		{#if prefs.tab === 'qr'}
			<input
				type="text"
				bind:value={qrText}
				placeholder={m['widget.toolbox.qr.text']()}
				aria-label={m['widget.toolbox.qr.text']()}
				data-testid="qr-text"
			/>
			{#if qrOverflow}
				<p class="tp-tb__error" role="alert">{m['widget.toolbox.qr.too_long']()}</p>
			{:else if matrix === null}
				<p class="tp-tb__hint">{m['widget.toolbox.qr.empty']()}</p>
			{:else}
				<!-- No `role="img"`: a canvas is an interactive element by default
				     and Svelte's a11y rules will not let it take a non-interactive
				     role. The label is what gets announced either way. -->
				<canvas
					bind:this={canvas}
					class="tp-tb__qr"
					data-testid="qr-canvas"
					aria-label={m['widget.toolbox.qr.preview']()}
				></canvas>
			{/if}
		{:else if prefs.tab === 'password'}
			<button
				type="button"
				class="tp-tb__primary"
				data-testid="password-generate"
				onclick={() => (password = generatePassword(PASSWORD_DEFAULTS))}
			>
				{m['widget.toolbox.password.generate']()}
			</button>
			{#if password === ''}
				<p class="tp-tb__hint">{m['widget.toolbox.password.none']()}</p>
			{:else}
				<output class="tp-tb__value tp-num" data-testid="password-value">{password}</output>
				<button type="button" onclick={() => void copy(password)}>
					{copied ? m['widget.toolbox.copied']() : m['widget.toolbox.copy']()}
				</button>
			{/if}
			<p class="tp-tb__meta tp-num">{m['widget.toolbox.password.entropy']({ bits })}</p>
		{:else}
			<div class="tp-tb__colorrow">
				<input
					type="color"
					value={colorInput}
					aria-label={m['widget.toolbox.color.pick']()}
					data-testid="color-input"
					onchange={(event) => pick(event.currentTarget.value)}
				/>
				<output class="tp-tb__value tp-num" data-testid="color-hex">
					{rgb === null ? m['widget.toolbox.color.invalid']() : toHex(rgb)}
				</output>
				<button type="button" onclick={() => void copy(rgb === null ? '' : toHex(rgb))}>
					{copied ? m['widget.toolbox.copied']() : m['widget.toolbox.copy']()}
				</button>
			</div>
			{#if prefs.recentColors.length === 0}
				<p class="tp-tb__hint">{m['widget.toolbox.color.recent_empty']()}</p>
			{:else}
				<ul class="tp-tb__swatches" aria-label={m['widget.toolbox.color.recent']()}>
					{#each prefs.recentColors as hex (hex)}
						<li>
							<button
								type="button"
								class="tp-tb__swatch"
								style:background={hex}
								aria-label={m['widget.toolbox.color.use']({ hex })}
								onclick={() => pick(hex)}
							></button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</div>

<style>
	.tp-tb {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.375rem;
		overflow: hidden;
	}

	.tp-tb__tabs {
		display: flex;
		flex: 0 0 auto;
		gap: 0.25rem;
	}

	[role='tab'] {
		flex: 1 1 0;
		min-height: 1.75rem;
		padding: 0 0.25rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
	}

	[role='tab'][aria-selected='true'] {
		border-color: var(--color-beacon);
		color: var(--color-fg);
	}

	.tp-tb__panel {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		min-height: 0;
		overflow: hidden;
	}

	input[type='text'] {
		width: 100%;
		min-height: 2rem;
		flex: 0 0 auto;
		padding: 0 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-2xs);
	}

	input[type='color'] {
		width: 2.25rem;
		height: 2rem;
		flex: 0 0 auto;
		padding: 0;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		cursor: pointer;
	}

	.tp-tb__qr {
		max-width: 100%;
		min-height: 0;
		max-height: 100%;
		/* Nearest-neighbour: a QR is modules, and smoothing them is what makes a
		   downscaled code stop scanning. */
		image-rendering: pixelated;
		object-fit: contain;
	}

	button:not([role='tab']) {
		min-height: 1.75rem;
		padding: 0 0.6rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
	}

	.tp-tb__primary {
		color: var(--color-beacon);
	}

	.tp-tb__value {
		width: 100%;
		overflow: hidden;
		color: var(--color-fg);
		font-size: var(--text-2xs);
		text-align: center;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-tb__hint,
	.tp-tb__meta {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		text-align: center;
	}

	.tp-tb__error {
		margin: 0;
		color: var(--color-warn);
		font-size: var(--text-2xs);
		text-align: center;
	}

	.tp-tb__colorrow {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.375rem;
	}

	.tp-tb__swatches {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-tb__swatch {
		width: 1.25rem;
		height: 1.25rem;
		min-height: 1.25rem;
		padding: 0;
		border: 1px solid var(--color-ink-700);
		border-radius: 4px;
	}
</style>
