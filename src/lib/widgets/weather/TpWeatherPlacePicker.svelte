<script lang="ts">
	import type { TpGeocodeResult } from '$lib/api-types';
	import { TpApiError } from '$lib/core/api';
	import { logEntry } from '$lib/core/log-buffer';
	import { m } from '$lib/paraglide/messages';
	import { online } from '$lib/stores/online.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { contextOf, isSearchable, SEARCH_DEBOUNCE_MS, searchPlaces } from './geocode';
	import { browserPosition, coarsePosition, type TpPositionSource } from './geolocate';
	import type { TpWeatherPlace } from './types';

	/**
	 * doc 08 §1's "default place picked at first add via search", and the
	 * `permission-needed` card's search fallback — one component, because they
	 * are the same question asked after two different answers.
	 *
	 * It lives inside the tile rather than in the detail: doc 13 §9 seeds a
	 * weather tile with no place, so the picker *is* the tile's `empty` state,
	 * and a reader who has to open a panel to make their first-run tile do
	 * anything has been given a chore rather than a dashboard.
	 *
	 * Search is a one-shot `fetchEnvelope`, never `swr` — see `geocode.ts` for
	 * why a per-keystroke key does not belong in a cache keyed by data identity.
	 */
	interface Props {
		onPick: (place: TpWeatherPlace) => void;
		/** Test seam. In headless Chromium the real geolocation API exists and is
		 *  auto-denied, so an unpatched test only ever sees the failure branch. */
		positionSource?: TpPositionSource | undefined;
	}

	let { onPick, positionSource = browserPosition }: Props = $props();

	type Phase = 'idle' | 'searching' | 'results' | 'empty' | 'offline' | 'error';

	let query = $state('');
	let phase = $state<Phase>('idle');
	let results = $state.raw<readonly TpGeocodeResult[]>([]);
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
			const found = await searchPlaces(term, settings.locale, own.signal);
			if (own.signal.aborted) return;
			results = found;
			phase = found.length === 0 ? 'empty' : 'results';
		} catch (error) {
			if (own.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return;
			results = [];
			phase = error instanceof TpApiError && error.code === 'NETWORK' ? 'offline' : 'error';
			logEntry('warn', 'place search failed', { src: 'widget', error });
		} finally {
			if (controller === own) controller = null;
		}
	}

	function choose(result: TpGeocodeResult): void {
		// Already at 2 dp by the time it reaches the client — the Worker rounds
		// before it caches (doc 15 §7) — and `readSettings` rounds again on the
		// way back out, so the stored place cannot be finer than a ~1 km cell.
		onPick({ name: result.name, lat: result.lat, lon: result.lon });
	}

	async function locate(): Promise<void> {
		locating = true;
		locateFailed = false;
		try {
			const at = await coarsePosition(positionSource);
			// An empty name, not a translated one: the string would be frozen in
			// `tp.layout.v1` at the locale it was picked in, and there is no
			// reverse-geocode endpoint to give it a real one (doc 10 §6 is forward
			// search only). The tile renders "my location" from the live catalogue
			// when the name is blank.
			onPick({ name: '', lat: at.lat, lon: at.lon });
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
			placeholder={m['widget.weather.search_placeholder']()}
			aria-label={m['widget.weather.search_label']()}
			data-testid="weather-search"
			autocomplete="off"
			spellcheck="false"
		/>
	</label>

	<!-- One live region for every answer the search can give, so a screen
	     reader hears the result rather than only seeing it. -->
	<div class="tp-pick__body" role="status" aria-live="polite">
		{#if phase === 'searching'}
			<p class="tp-pick__note">{m['widget.weather.searching']()}</p>
		{:else if phase === 'results'}
			<ul class="tp-pick__list" data-testid="weather-results">
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
			<p class="tp-pick__note" data-testid="weather-no-results">
				{m['widget.weather.no_results']({ query })}
			</p>
		{:else if phase === 'offline'}
			<p class="tp-pick__note" data-testid="weather-search-offline">
				{m['widget.weather.search_offline']()}
			</p>
		{:else if phase === 'error'}
			<p class="tp-pick__note" data-testid="weather-search-error">
				{m['widget.weather.search_failed']()}
			</p>
		{/if}
	</div>

	<div class="tp-pick__foot">
		<button
			type="button"
			class="tp-pick__locate"
			onclick={locate}
			disabled={locating}
			data-testid="weather-locate"
		>
			<TpIcon name="locate" size={13} />
			{locating ? m['widget.weather.locating']() : m['widget.weather.use_my_location']()}
		</button>
		{#if locateFailed}
			<span class="tp-pick__note" role="alert" data-testid="weather-locate-failed">
				{m['widget.weather.locate_failed']()}
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
