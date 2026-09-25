<script lang="ts">
	import type { TpGeocodeResult } from '$lib/api-types';
	import { TpApiError } from '$lib/core/api';
	import {
		contextOf,
		dedupeResults,
		isSearchable,
		SEARCH_DEBOUNCE_MS,
		searchPlaces,
		type TpPlacePick
	} from '$lib/core/geocode';
	import { browserPosition, coarsePosition, type TpPositionSource } from '$lib/core/geolocate';
	import { logEntry } from '$lib/core/log-buffer';
	import { m } from '$lib/paraglide/messages';
	import { online } from '$lib/stores/online.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';

	/**
	 * Place search with "use my location" beside it — the weather tile's first
	 * control since Week 4, and the map's search box since Week 6 (doc 03 §1:
	 * graduated on its second consumer, as `TpPlaceSearch` from
	 * `widgets/weather/TpWeatherPlacePicker`).
	 *
	 * **It hands back what the geocoder said, unrounded.** Rounding is the
	 * caller's decision, because the two callers disagree for good reasons: a
	 * weather place is stored at 2 dp (doc 08 §1) and only ever used at that
	 * precision, while a saved map place is public data about a point and keeps
	 * the geocoder's precision (Week 6 plan S6). The one coordinate that is never
	 * precise is the reader's own: "use my location" comes back already coarse,
	 * from `coarsePosition`, because doc 16 §3 requires that before it leaves
	 * the module that received the fix.
	 *
	 * Search is a one-shot `fetchEnvelope`, never `swr` — see `core/geocode.ts`
	 * for why a per-keystroke key does not belong in a cache keyed by data
	 * identity.
	 */
	interface Props {
		onPick: (place: TpPlacePick) => void;
		/** Test seam. In headless Chromium the real geolocation API exists and is
		 *  auto-denied, so an unpatched test only ever sees the failure branch. */
		positionSource?: TpPositionSource | undefined;
	}

	let { onPick, positionSource = browserPosition }: Props = $props();

	type Phase = 'idle' | 'searching' | 'results' | 'empty' | 'offline' | 'rate-limited' | 'error';

	let query = $state('');
	let phase = $state<Phase>('idle');
	let results = $state.raw<readonly TpGeocodeResult[]>([]);
	/** The wait a 429 named, in seconds, when it named one. */
	let waitSeconds = $state<number | undefined>(undefined);
	let locating = $state(false);
	let locateFailed = $state(false);

	let timer: ReturnType<typeof setTimeout> | null = null;
	let controller: AbortController | null = null;

	$effect(() => {
		return () => {
			// A tile removed mid-search must not leave a request or a timer behind
			// — the same discipline the scheduler and `swr` are held to.
			if (timer !== null) clearTimeout(timer);
			controller?.abort();
		};
	});

	function onInput(event: Event): void {
		query = (event.currentTarget as HTMLInputElement).value;
		locateFailed = false;

		if (timer !== null) clearTimeout(timer);
		// One flight at a time. Without this the answer to a two-letter prefix
		// can land after the answer to the whole word and overwrite it.
		controller?.abort();
		controller = null;

		if (!isSearchable(query)) {
			phase = 'idle';
			results = [];
			return;
		}

		phase = 'searching';
		timer = setTimeout(() => void run(query), SEARCH_DEBOUNCE_MS);
	}

	async function run(term: string): Promise<void> {
		// doc 17 §3's search-dependent class: offline is a card that says so,
		// not a request that fails and reports it as an upstream problem.
		if (!online.isOnline) {
			phase = 'offline';
			results = [];
			return;
		}

		const own = new AbortController();
		controller = own;

		try {
			const found = dedupeResults(await searchPlaces(term, settings.locale, own.signal));
			if (own.signal.aborted) return;
			results = found;
			phase = found.length === 0 ? 'empty' : 'results';
		} catch (error) {
			if (own.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
			results = [];
			if (error instanceof TpApiError && error.code === 'NETWORK') {
				phase = 'offline';
			} else if (error instanceof TpApiError && error.code === 'RATE_LIMITED') {
				// doc 08 §5's "geocode rate-limit 429 → inline retry-after message".
				// Until Week 6 this read as the generic failure, which tells a reader
				// who typed too fast that search is broken rather than to wait.
				phase = 'rate-limited';
				// "Try again in 0 s" tells a reader nothing, so a wait of nothing is
				// said as "a moment". (It is also what an absent header used to read
				// as — `Number(null)` is 0 — until #24.)
				const named = error.retryAfterS;
				waitSeconds = named !== undefined && named > 0 ? Math.ceil(named) : undefined;
			} else {
				phase = 'error';
			}
			logEntry('warn', 'place search failed', { src: 'widget', error });
		} finally {
			if (controller === own) controller = null;
		}
	}

	function choose(result: TpGeocodeResult): void {
		onPick({ name: result.name, context: contextOf(result), lat: result.lat, lon: result.lon });
	}

	async function locate(): Promise<void> {
		locating = true;
		locateFailed = false;
		try {
			const at = await coarsePosition(positionSource);
			onPick({ name: '', context: '', lat: at.lat, lon: at.lon });
		} catch (error) {
			locateFailed = true;
			logEntry('info', 'geolocation refused or unavailable', { src: 'widget', error });
		} finally {
			locating = false;
		}
	}
</script>

<div class="tp-pick">
	<label class="tp-pick__field">
		<TpIcon name="search" size={14} />
		<input
			type="search"
			value={query}
			oninput={onInput}
			placeholder={m['common.place.search_placeholder']()}
			aria-label={m['common.place.search_label']()}
			data-testid="place-search"
			autocomplete="off"
			spellcheck="false"
		/>
	</label>

	<!-- One live region for every answer the search can give, so a screen
	     reader hears the result rather than only seeing it. -->
	<div class="tp-pick__body" role="status" aria-live="polite">
		{#if phase === 'searching'}
			<p class="tp-pick__note">{m['common.place.searching']()}</p>
		{:else if phase === 'results'}
			<ul class="tp-pick__list" data-testid="place-results">
				{#each results as result (`${result.name}:${String(result.lat)}:${String(result.lon)}`)}
					{@const context = contextOf(result)}
					<li>
						<!-- Names from upstream are text nodes. Never `{@html}` — CLAUDE.md
						     rule 7 names geocode results specifically. -->
						<button type="button" onclick={() => choose(result)}>
							<span class="tp-pick__name">{result.name}</span>
							{#if context !== ''}
								<span class="tp-pick__context">{context}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else if phase === 'empty'}
			<p class="tp-pick__note" data-testid="place-no-results">
				{m['common.place.no_results']({ query })}
			</p>
		{:else if phase === 'offline'}
			<p class="tp-pick__note" data-testid="place-search-offline">
				{m['common.place.search_offline']()}
			</p>
		{:else if phase === 'rate-limited'}
			<p class="tp-pick__note" data-testid="place-search-limited">
				{waitSeconds === undefined
					? m['common.place.rate_limited_soon']()
					: m['common.place.rate_limited']({ seconds: waitSeconds })}
			</p>
		{:else if phase === 'error'}
			<p class="tp-pick__note" data-testid="place-search-error">
				{m['common.place.search_failed']()}
			</p>
		{/if}
	</div>

	<div class="tp-pick__foot">
		<button
			type="button"
			class="tp-pick__locate"
			onclick={locate}
			disabled={locating}
			data-testid="place-locate"
		>
			<TpIcon name="locate" size={13} />
			{locating ? m['common.place.locating']() : m['common.place.use_my_location']()}
		</button>
		{#if locateFailed}
			<span class="tp-pick__note" role="alert" data-testid="place-locate-failed">
				{m['common.place.locate_failed']()}
			</span>
		{/if}
	</div>
</div>

<style>
	.tp-pick {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.375rem;
		min-height: 0;
	}

	.tp-pick__field {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: none;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		padding: 0 0.5rem;
		color: var(--color-fg-dim);
	}

	.tp-pick__field:focus-within {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	.tp-pick__field input {
		flex: 1 1 auto;
		min-width: 0;
		border: 0;
		background: none;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-2xs);
		padding: 0.3rem 0;
	}

	.tp-pick__field input:focus {
		outline: none;
	}

	/* The one scrolling region. doc 08 §1's tile is 2×2 at its smallest and the
	   list has to fit inside it without pushing the locate button off. */
	.tp-pick__body {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
	}

	.tp-pick__list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-pick__list button {
		display: flex;
		width: 100%;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.05rem;
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		padding: 0.25rem 0.375rem;
		text-align: left;
	}

	.tp-pick__list button:hover,
	.tp-pick__list button:focus-visible {
		background: var(--color-ink-850);
	}

	.tp-pick__name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.tp-pick__context {
		color: var(--color-fg-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}

	.tp-pick__note {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-pick__foot {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
	}

	.tp-pick__locate {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 0;
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		padding: 0;
	}

	.tp-pick__locate:disabled {
		color: var(--color-fg-dim);
		cursor: default;
	}
</style>
