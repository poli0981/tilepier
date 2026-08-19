<script lang="ts">
	import { collectEnv, formatReport, issueUrl } from '$lib/core/bug-report';
	import { m } from '$lib/paraglide/messages';
	import { deck } from '$lib/stores/deck.svelte';
	import { online } from '$lib/stores/online.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';

	/**
	 * doc 18 §4. The report is assembled, shown, and *editable* before it goes
	 * anywhere — nothing is sent automatically, and the user is the one who
	 * sends it. That is the whole privacy story for bug reports (doc 16 §3.5).
	 */
	interface Props {
		open: boolean;
		/** From the 500 page, so a report can be tied to the error it came from. */
		errorId?: string | undefined;
		onClose: () => void;
	}

	let { open, errorId = undefined, onClose }: Props = $props();

	let body = $state('');
	let copied = $state(false);

	$effect(() => {
		if (!open) return;

		// Rebuilt each time it opens: the log and the deck have both moved on
		// since any previous look.
		body = formatReport(
			collectEnv({
				version: __TP_BUILD__.version,
				sha: __TP_BUILD__.sha,
				locale: settings.locale,
				theme: settings.resolvedTheme,
				widgetIds: deck.widgetIds,
				online: online.isOnline
			}),
			errorId
		);
		copied = false;
	});

	async function copyAndOpen(): Promise<void> {
		try {
			await navigator.clipboard.writeText(body);
			copied = true;
		} catch {
			// Clipboard permission can be refused; the textarea is still right
			// there and selectable, so this is a nicety failing, not the flow.
			copied = false;
		}
		window.open(issueUrl(__TP_BUILD__.version), '_blank', 'noopener');
	}

	function download(): void {
		// doc 18 §4: for anyone without a GitHub account.
		const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = `tilepier-log-${__TP_BUILD__.sha}.txt`;
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

{#if open}
	<div class="tp-sheet__scrim" role="presentation" onclick={onClose} data-testid="bug-scrim"></div>

	<div
		class="tp-bug"
		role="dialog"
		aria-modal="true"
		aria-label={m['settings.report.title']()}
		data-testid="bug-dialog"
	>
		<header>
			<h2>{m['settings.report.title']()}</h2>
			<button type="button" aria-label={m['common.dismiss']()} onclick={onClose}>
				<TpIcon name="close" size={18} />
			</button>
		</header>

		<p class="tp-bug__note">{m['settings.report.privacy_note']()}</p>

		<!-- Editable on purpose: doc 18 §4 wants the user to review and trim
		     before anything leaves the device. -->
		<textarea bind:value={body} rows="12" data-testid="bug-body" spellcheck="false"></textarea>

		<div class="tp-bug__actions">
			<button type="button" class="tp-action" data-testid="bug-copy" onclick={copyAndOpen}>
				{copied ? m['settings.report.copied']() : m['settings.report.copy_open']()}
			</button>
			<button type="button" class="tp-action" data-testid="bug-download" onclick={download}>
				{m['settings.report.download']()}
			</button>
		</div>
	</div>
{/if}

<style>
	.tp-sheet__scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: color-mix(in oklch, var(--color-ink-950) 80%, transparent);
	}

	.tp-bug {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 71;
		transform: translate(-50%, -50%);
		width: min(44rem, calc(100vw - 2rem));
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-850);
		box-shadow: var(--shadow-tile);
		padding: 1rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
	}

	header button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 40px;
		min-height: 40px;
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
	}

	.tp-bug__note {
		margin: 0.25rem 0 0.75rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		padding: 0.5rem;
		color: var(--color-fg-mute);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		resize: vertical;
	}

	.tp-bug__actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.tp-action {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 36px;
		padding: 0 0.75rem;
	}
</style>
