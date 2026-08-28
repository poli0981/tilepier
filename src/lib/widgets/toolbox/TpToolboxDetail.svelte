<script lang="ts">
	import type { TpDetailProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import {
		contrastRatio,
		contrastVerdict,
		parseHex,
		ramp,
		rgbToHsl,
		toHex,
		toHslString,
		toRgbString
	} from './color';
	import {
		alphabetFor,
		clampLength,
		entropyBits,
		generatePassword,
		PASSWORD_DEFAULTS,
		PASSWORD_LIMITS,
		type TpPasswordOptions
	} from './password';
	import { drawQr, isQrEcc, qrMatrix, QR_ECC_LEVELS, QR_QUIET_ZONE, type TpQrMatrix } from './qr';
	import { pushRecentColor, readSettings } from './service';
	import { TOOLBOX_TABS, type TpToolboxTab } from './types';

	/**
	 * doc 07 §7 — the detail: all three tools full width, with the options the
	 * tile has no room for.
	 *
	 * The tab still comes from the tile's settings, so opening the detail lands
	 * on whatever the tile was showing and closing it leaves the tile where the
	 * detail was left. One state, two views.
	 */
	let { settings: tileSettings, onUpdateSettings }: TpDetailProps = $props();

	const prefs = $derived(readSettings(tileSettings));

	/* ── qr ── */
	let qrText = $state('');
	let ecc = $state<(typeof QR_ECC_LEVELS)[number]>('M');
	let scale = $state(6);
	let matrix = $state<TpQrMatrix | null>(null);
	let qrOverflow = $state(false);
	let canvas = $state<HTMLCanvasElement | null>(null);

	/* ── password ── */
	let options = $state<TpPasswordOptions>({ ...PASSWORD_DEFAULTS });
	let password = $state('');
	const bits = $derived(entropyBits(options));
	const noClasses = $derived(alphabetFor(options).length === 0);

	/* ── colour ── */
	// doc 20 §1's `tokens-audit-ignore`, on the same grounds as the settings
	// panel's accent swatches: seeds of user-selectable data rather than
	// styling. They are the beacon and `ink-900` so the contrast check opens on
	// a pair worth checking; `color.test.ts` asserts both token values against
	// doc 13 §8, so the duplication cannot drift unnoticed.
	// tokens-audit-ignore
	let colorInput = $state('#46d5c8');
	// tokens-audit-ignore
	let againstInput = $state('#0b0f14');
	/** What the native picker shows while the hex field is half-typed. Not a
	 *  design colour — `<input type=color>` refuses anything that is not a
	 *  six-digit hex, so it needs *some* value. */
	// tokens-audit-ignore
	const PICKER_FALLBACK = '#000000';
	const rgb = $derived(parseHex(colorInput));
	const against = $derived(parseHex(againstInput));
	const ratio = $derived(rgb === null || against === null ? null : contrastRatio(rgb, against));
	const verdict = $derived(ratio === null ? null : contrastVerdict(ratio));
	const steps = $derived(rgb === null ? [] : ramp(rgb));

	let copied = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	function setTab(tab: TpToolboxTab): void {
		onUpdateSettings?.({ tab });
	}

	async function copy(key: string, value: string): Promise<void> {
		if (value === '') return;
		await navigator.clipboard.writeText(value);
		copied = key;
		if (copyTimer !== null) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = null), 1400);
	}

	$effect(() => {
		return () => {
			if (copyTimer !== null) clearTimeout(copyTimer);
		};
	});

	$effect(() => {
		// Re-encodes on either the text or the correction level, since both
		// change how much fits and therefore the version.
		const text = qrText;
		const level = ecc;
		let cancelled = false;

		void qrMatrix(text, level).then((next) => {
			if (cancelled) return;
			matrix = next;
			qrOverflow = next === null && text !== '';
		});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		// Repaints on a scale change without re-encoding.
		const element = canvas;
		const current = matrix;
		const px = scale;
		if (element === null || current === null) return;

		drawQr(element, current, {
			scale: px,
			margin: QR_QUIET_ZONE,
			dark: '#000000', // tokens-audit-ignore — a QR is scanned, not themed
			light: '#ffffff' // tokens-audit-ignore
		});
	});

	function downloadPng(): void {
		const element = canvas;
		if (element === null || matrix === null) return;

		element.toBlob((blob) => {
			if (blob === null) return;
			// An object URL rather than a data URL: a version-40 PNG at scale 12
			// is megabytes of base64 in an href, and the browser has to hold all
			// of it as a string. Revoked on the next frame, once the click has
			// been dispatched.
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = 'tilepier-qr.png';
			link.click();
			requestAnimationFrame(() => URL.revokeObjectURL(url));
		}, 'image/png');
	}

	function pick(value: string): void {
		colorInput = value;
		const parsed = parseHex(value);
		if (parsed === null) return;
		onUpdateSettings?.({ recentColors: pushRecentColor(prefs.recentColors, toHex(parsed)) });
	}

	function eccLabel(level: string): string {
		if (level === 'L') return m['widget.toolbox.qr.ecc_l']();
		if (level === 'Q') return m['widget.toolbox.qr.ecc_q']();
		if (level === 'H') return m['widget.toolbox.qr.ecc_h']();
		return m['widget.toolbox.qr.ecc_m']();
	}

	function verdictLabel(value: string): string {
		if (value === 'AAA') return m['widget.toolbox.color.verdict_aaa']();
		if (value === 'AA') return m['widget.toolbox.color.verdict_aa']();
		if (value === 'AA-large') return m['widget.toolbox.color.verdict_aa_large']();
		return m['widget.toolbox.color.verdict_fail']();
	}
</script>

<div class="tp-tbd">
	<div class="tp-tbd__tabs" role="tablist" aria-label={m['widget.toolbox.title']()}>
		{#each TOOLBOX_TABS as tab (tab)}
			<button
				type="button"
				role="tab"
				aria-selected={prefs.tab === tab}
				data-testid="dtab-{tab}"
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

	{#if prefs.tab === 'qr'}
		<section aria-label={m['widget.toolbox.tab.qr']()}>
			<label>
				{m['widget.toolbox.qr.text']()}
				<input type="text" bind:value={qrText} data-testid="dqr-text" />
			</label>

			<div class="tp-tbd__row">
				<label>
					{m['widget.toolbox.qr.ecc']()}
					<select
						value={ecc}
						data-testid="dqr-ecc"
						onchange={(event) => {
							const next = event.currentTarget.value;
							if (isQrEcc(next)) ecc = next;
						}}
					>
						{#each QR_ECC_LEVELS as level (level)}
							<option value={level}>{eccLabel(level)}</option>
						{/each}
					</select>
				</label>
				<label>
					{m['widget.toolbox.qr.scale']()}
					<input type="range" min="2" max="12" bind:value={scale} />
				</label>
			</div>

			{#if qrOverflow}
				<p class="tp-tbd__error" role="alert">{m['widget.toolbox.qr.too_long']()}</p>
			{:else if matrix === null}
				<p class="tp-tbd__hint">{m['widget.toolbox.qr.empty']()}</p>
			{:else}
				<!-- No `role="img"`: a canvas is an interactive element by default
				     and Svelte's a11y rules will not let it take a non-interactive
				     role. The label is what gets announced either way. -->
				<canvas
					bind:this={canvas}
					class="tp-tbd__qr"
					data-testid="dqr-canvas"
					aria-label={m['widget.toolbox.qr.preview']()}
				></canvas>
				<div class="tp-tbd__row">
					<button type="button" onclick={downloadPng}>
						{m['widget.toolbox.qr.download']()}
					</button>
					<button type="button" onclick={() => void copy('qr', qrText)}>
						{copied === 'qr' ? m['widget.toolbox.copied']() : m['widget.toolbox.copy']()}
					</button>
				</div>
			{/if}
		</section>
	{:else if prefs.tab === 'password'}
		<section aria-label={m['widget.toolbox.tab.password']()}>
			<label>
				{m['widget.toolbox.password.length']()}
				<input
					type="range"
					min={PASSWORD_LIMITS.min}
					max={PASSWORD_LIMITS.max}
					value={options.length}
					data-testid="dpw-length"
					oninput={(event) =>
						(options = { ...options, length: clampLength(Number(event.currentTarget.value)) })}
				/>
				<span class="tp-num">{options.length}</span>
			</label>

			<div class="tp-tbd__row">
				<label class="tp-tbd__check">
					<input type="checkbox" bind:checked={options.lower} />
					{m['widget.toolbox.password.lower']()}
				</label>
				<label class="tp-tbd__check">
					<input type="checkbox" bind:checked={options.upper} />
					{m['widget.toolbox.password.upper']()}
				</label>
				<label class="tp-tbd__check">
					<input type="checkbox" bind:checked={options.digits} />
					{m['widget.toolbox.password.digits']()}
				</label>
				<label class="tp-tbd__check">
					<input type="checkbox" bind:checked={options.symbols} />
					{m['widget.toolbox.password.symbols']()}
				</label>
				<label class="tp-tbd__check">
					<input type="checkbox" bind:checked={options.noAmbiguous} />
					{m['widget.toolbox.password.no_ambiguous']()}
				</label>
			</div>

			{#if noClasses}
				<p class="tp-tbd__error" role="alert">{m['widget.toolbox.password.no_classes']()}</p>
			{:else}
				<p class="tp-tbd__meta tp-num" data-testid="dpw-entropy">
					{m['widget.toolbox.password.entropy']({ bits })}
				</p>
			{/if}

			<div class="tp-tbd__row">
				<button
					type="button"
					class="tp-tbd__primary"
					disabled={noClasses}
					data-testid="dpw-generate"
					onclick={() => (password = generatePassword(options))}
				>
					{m['widget.toolbox.password.generate']()}
				</button>
				{#if password !== ''}
					<button type="button" onclick={() => void copy('pw', password)}>
						{copied === 'pw' ? m['widget.toolbox.copied']() : m['widget.toolbox.copy']()}
					</button>
				{/if}
			</div>

			{#if password === ''}
				<p class="tp-tbd__hint">{m['widget.toolbox.password.none']()}</p>
			{:else}
				<output class="tp-tbd__value tp-num" data-testid="dpw-value">{password}</output>
			{/if}

			<!-- doc 07 §7 says a generated value is never stored. Saying so where
			     the value is is worth more than saying it in a privacy page. -->
			<p class="tp-tbd__note">{m['widget.toolbox.password.not_stored']()}</p>
		</section>
	{:else}
		<section aria-label={m['widget.toolbox.tab.color']()}>
			<div class="tp-tbd__row">
				<input
					type="color"
					value={rgb === null ? PICKER_FALLBACK : toHex(rgb)}
					aria-label={m['widget.toolbox.color.pick']()}
					data-testid="dcolor-picker"
					onchange={(event) => pick(event.currentTarget.value)}
				/>
				<label>
					{m['widget.toolbox.color.hex']()}
					<input type="text" bind:value={colorInput} data-testid="dcolor-hex" class="tp-num" />
				</label>
			</div>

			{#if rgb === null}
				<p class="tp-tbd__error" role="alert">{m['widget.toolbox.color.invalid']()}</p>
			{:else}
				<ul class="tp-tbd__formats">
					{#each [{ key: 'hex', label: m['widget.toolbox.color.hex'](), value: toHex(rgb) }, { key: 'rgb', label: m['widget.toolbox.color.rgb'](), value: toRgbString(rgb) }, { key: 'hsl', label: m['widget.toolbox.color.hsl'](), value: toHslString(rgbToHsl(rgb)) }] as format (format.key)}
						<li>
							<span class="tp-tbd__flabel">{format.label}</span>
							<span class="tp-num">{format.value}</span>
							<button type="button" onclick={() => void copy(format.key, format.value)}>
								{copied === format.key ? m['widget.toolbox.copied']() : m['widget.toolbox.copy']()}
							</button>
						</li>
					{/each}
				</ul>

				<h4>{m['widget.toolbox.color.contrast']()}</h4>
				<div class="tp-tbd__row">
					<label>
						{m['widget.toolbox.color.against']()}
						<input
							type="text"
							bind:value={againstInput}
							data-testid="dcolor-against"
							class="tp-num"
						/>
					</label>
					{#if ratio !== null && verdict !== null}
						<p class="tp-tbd__ratio" data-testid="dcolor-ratio">
							<span class="tp-num">
								{m['widget.toolbox.color.ratio']({ ratio: ratio.toFixed(2) })}
							</span>
							<span class="tp-tbd__verdict" data-verdict={verdict}>{verdictLabel(verdict)}</span>
						</p>
					{/if}
				</div>

				<h4>{m['widget.toolbox.color.ramp']()}</h4>
				<ul class="tp-tbd__ramp">
					{#each steps as step, i (i)}
						{@const hex = toHex(step)}
						<li>
							<button
								type="button"
								class="tp-tbd__swatch"
								style:background={hex}
								aria-label={m['widget.toolbox.color.use']({ hex })}
								onclick={() => pick(hex)}
							></button>
							<span class="tp-num">{hex}</span>
						</li>
					{/each}
				</ul>
			{/if}

			<h4>{m['widget.toolbox.color.recent']()}</h4>
			{#if prefs.recentColors.length === 0}
				<p class="tp-tbd__hint">{m['widget.toolbox.color.recent_empty']()}</p>
			{:else}
				<ul class="tp-tbd__swatches">
					{#each prefs.recentColors as hex (hex)}
						<li>
							<button
								type="button"
								class="tp-tbd__swatch"
								style:background={hex}
								aria-label={m['widget.toolbox.color.use']({ hex })}
								onclick={() => pick(hex)}
							></button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>

<style>
	.tp-tbd {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.5rem 0;
	}

	.tp-tbd__tabs {
		display: flex;
		gap: 0.375rem;
	}

	[role='tab'] {
		min-height: 2.5rem;
		padding: 0 0.9rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
	}

	[role='tab'][aria-selected='true'] {
		border-color: var(--color-beacon);
		color: var(--color-fg);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-tbd__check {
		flex-direction: row;
		align-items: center;
		gap: 0.375rem;
		min-height: 2.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-tbd__row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
	}

	input[type='text'],
	select {
		min-height: 2.5rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
	}

	input[type='color'] {
		width: 3rem;
		height: 2.5rem;
		padding: 0;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		cursor: pointer;
	}

	button:not([role='tab']) {
		min-height: 2.5rem;
		padding: 0 0.75rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
	}

	button:disabled {
		color: var(--color-ink-500);
		cursor: default;
	}

	.tp-tbd__primary {
		color: var(--color-beacon);
	}

	.tp-tbd__qr {
		align-self: flex-start;
		max-width: 100%;
		image-rendering: pixelated;
	}

	h4 {
		margin: 0.5rem 0 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.tp-tbd__value {
		overflow-wrap: anywhere;
		color: var(--color-fg);
		font-size: var(--text-sm);
	}

	.tp-tbd__hint,
	.tp-tbd__note,
	.tp-tbd__meta {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-tbd__error {
		margin: 0;
		color: var(--color-warn);
		font-size: var(--text-xs);
	}

	.tp-tbd__formats,
	.tp-tbd__ramp,
	.tp-tbd__swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-tbd__formats {
		flex-direction: column;
	}

	.tp-tbd__formats li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-fg);
		font-size: var(--text-xs);
	}

	.tp-tbd__flabel {
		min-width: 2.5rem;
		color: var(--color-fg-dim);
	}

	.tp-tbd__ramp li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-tbd__swatch {
		width: 2.5rem;
		height: 2.5rem;
		min-height: 2.5rem;
		padding: 0;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
	}

	.tp-tbd__ratio {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-sm);
	}

	.tp-tbd__verdict {
		font-size: var(--text-2xs);
	}

	.tp-tbd__verdict[data-verdict='AAA'],
	.tp-tbd__verdict[data-verdict='AA'] {
		color: var(--color-up);
	}

	.tp-tbd__verdict[data-verdict='AA-large'] {
		color: var(--color-warn);
	}

	.tp-tbd__verdict[data-verdict='fail'] {
		color: var(--color-down);
	}
</style>
