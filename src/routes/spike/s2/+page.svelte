<script lang="ts">
	import { db } from '$lib/core/storage/db';
	import {
		estimateQuota,
		ingest,
		loadMusicRoot,
		queryRootPermission,
		requestRootPermission,
		saveMusicRoot,
		supportsFsa,
		walkAudioFiles,
		willExceedQuota,
		type FsaPermission,
		type QuotaEstimate
	} from '$lib/widgets/music/library';

	/**
	 * Spike S2 harness — doc 22 §S2.
	 *
	 * Path B (file import) is fully drivable from Playwright, so the timings and
	 * counts below are asserted by e2e/s2-fsa.e2e.ts. Path A needs a real
	 * directory picker, which no automation can operate — those controls are
	 * here for the manual check the spike findings describe.
	 */

	let status = $state('idle');
	let trackCount = $state(0);
	let parsed = $state(0);
	let total = $state(0);
	let elapsedMs = $state(0);
	let quota = $state<QuotaEstimate | null>(null);
	let permission = $state<FsaPermission | 'none'>('none');
	let hasStoredHandle = $state(false);
	let coverBlobCount = $state(0);
	let uiTicks = $state(0);

	// A counter driven by rAF: if the main thread stalls during a scan, this
	// stops advancing. That is the "UI responsive" half of the pass criterion,
	// and it is otherwise very easy to claim without evidence.
	$effect(() => {
		let raf = 0;
		const tick = () => {
			uiTicks += 1;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	$effect(() => {
		// Synchronises the readouts with what is already in storage on load.
		void refresh();
	});

	async function refresh() {
		trackCount = await db.tracks.count();
		coverBlobCount = await db.trackBlobs.where('id').startsWith('cover:').count();
		quota = await estimateQuota();
		const handle = await loadMusicRoot();
		hasStoredHandle = !!handle;
		permission = handle ? await queryRootPermission(handle) : 'none';
	}

	async function onImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const picked = [...(input.files ?? [])];
		if (!picked.length) return;

		const incoming = picked.reduce((sum, f) => sum + f.size, 0);
		if (willExceedQuota(await estimateQuota(), incoming)) {
			status = 'quota-warning';
			return;
		}

		status = 'scanning';
		parsed = 0;
		total = picked.length;
		const started = performance.now();

		await ingest(
			picked.map((file) => ({ relPath: file.name, file })),
			{
				source: 'blob',
				storeBlobs: true,
				onProgress: (p) => {
					parsed = p.parsed;
				}
			}
		);

		elapsedMs = Math.round(performance.now() - started);
		status = 'done';
		await refresh();
	}

	// ── path A, manual only ──────────────────────────────────────────────────

	async function pickFolder() {
		const picker = window.showDirectoryPicker;
		if (!picker) return;
		status = 'picking';
		try {
			const handle = await picker.call(window, { mode: 'read' });
			await saveMusicRoot(handle);
			await refresh();
			status = 'folder-saved';
		} catch {
			status = 'picker-cancelled';
		}
	}

	async function relink() {
		const handle = await loadMusicRoot();
		if (!handle) return;
		permission = await requestRootPermission(handle);
		status = `permission-${permission}`;
	}

	async function scanFolder() {
		const handle = await loadMusicRoot();
		if (!handle) return;

		status = 'scanning';
		parsed = 0;
		const started = performance.now();

		const found: { relPath: string; file: File }[] = [];
		for await (const entry of walkAudioFiles(handle)) found.push(entry);
		total = found.length;

		await ingest(found, {
			source: 'fsa',
			storeBlobs: false,
			onProgress: (p) => {
				parsed = p.parsed;
			}
		});

		elapsedMs = Math.round(performance.now() - started);
		status = 'done';
		await refresh();
	}

	async function wipe() {
		await db.tracks.clear();
		await db.trackBlobs.clear();
		status = 'wiped';
		await refresh();
	}
</script>

<svelte:head><title>Spike S2 — music library ingestion</title></svelte:head>

<main>
	<h1>Spike S2 — File System Access + import fallback</h1>

	<section>
		<h2>Path B — import (every browser)</h2>
		<input type="file" multiple accept="audio/*" data-testid="import" onchange={onImport} />
	</section>

	<section>
		<h2>Path A — folder (Chromium, manual)</h2>
		<p class="hint">
			A directory picker cannot be driven by automation; these are for the manual check. FSA
			supported: <b data-testid="fsa-supported">{supportsFsa() ? 'yes' : 'no'}</b>
		</p>
		<div class="controls">
			<button type="button" data-testid="pick" onclick={pickFolder}>pick folder</button>
			<button type="button" data-testid="relink" onclick={relink}>re-link</button>
			<button type="button" data-testid="scan" onclick={scanFolder}>scan</button>
			<button type="button" data-testid="wipe" onclick={wipe}>wipe library</button>
		</div>
	</section>

	<dl class="readout tp-num">
		<div>
			<dt>status</dt>
			<dd data-testid="status">{status}</dd>
		</div>
		<div>
			<dt>tracks</dt>
			<dd data-testid="track-count">{trackCount}</dd>
		</div>
		<div>
			<dt>parsed</dt>
			<dd data-testid="parsed">{parsed}/{total}</dd>
		</div>
		<div>
			<dt>elapsed</dt>
			<dd data-testid="elapsed">{elapsedMs}</dd>
		</div>
		<div>
			<dt>covers</dt>
			<dd data-testid="cover-count">{coverBlobCount}</dd>
		</div>
		<div>
			<dt>ui ticks</dt>
			<dd data-testid="ui-ticks">{uiTicks}</dd>
		</div>
		<div>
			<dt>handle</dt>
			<dd data-testid="has-handle">{hasStoredHandle ? 'yes' : 'no'}</dd>
		</div>
		<div>
			<dt>permission</dt>
			<dd data-testid="permission">{permission}</dd>
		</div>
	</dl>

	<p class="readout" data-testid="quota">
		{quota
			? `${(quota.usageBytes / 1048576).toFixed(1)} MB of ${(quota.quotaBytes / 1048576).toFixed(0)} MB (${(quota.ratio * 100).toFixed(1)}%)`
			: 'quota estimate unavailable'}
	</p>
</main>

<style>
	main {
		max-width: 900px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	h1 {
		margin: 0 0 1rem;
		font-size: var(--text-md);
		font-weight: 600;
	}

	h2 {
		margin: 0 0 0.5rem;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--color-fg-mute);
		text-transform: lowercase;
	}

	section {
		margin-bottom: 1.25rem;
	}

	.hint {
		margin: 0 0 0.5rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.controls button {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		padding: 0.4rem 0.9rem;
		min-height: 40px;
		cursor: pointer;
	}

	.readout {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
		margin: 1rem 0 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.readout div {
		display: flex;
		gap: 0.4rem;
	}

	.readout dt,
	.readout dd {
		margin: 0;
	}

	.readout dd {
		color: var(--color-beacon);
	}
</style>
