<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpPlacePick } from '$lib/core/geocode';
	import {
		browserGeoPermission,
		type TpGeoPermission,
		type TpPermissionSource,
		type TpPositionSource
	} from '$lib/core/geolocate';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpWidgetProps } from '$lib/core/types';
	import TpMap, { type TpMapPin, type TpMapStatus } from '$lib/map/TpMap.svelte';
	import { osmUrl } from '$lib/map/styles';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpPlaceSearch from '$lib/ui/TpPlaceSearch.svelte';
	import { places } from './places.svelte';
	import { coordinateText, placeLabel, readSettings } from './service';
	import { HOME_ZOOM } from './types';

	/**
	 * doc 08 §5's tile: a still picture of the map around home, with the saved
	 * places on it and a count of them. Clicking it opens the detail, which is
	 * where the map moves.
	 *
	 * **Nothing is fetched from OpenFreeMap until there is a home.** The tile's
	 * `empty` state says who draws the map, and what they see, *before* the
	 * first request — the Week 6 decision that let the map ship without a new
	 * legal version (plan S1): the notice is in place, at the moment it becomes
	 * true.
	 *
	 * **States (doc 06 §3).** `map` is search-dependent, and has no `swr`
	 * payload, so `stale` and `stale-error` cannot happen (plan S5); the rest:
	 * - `empty` — no home: the notice, and the search that sets one.
	 * - `loading` — the MapLibre modules and the style on their way: a skeleton.
	 * - `ready` — the map.
	 * - `offline` / `error` — the style could not be fetched: a card that still
	 *   gives the home's coordinates and a way out to OpenStreetMap, and a retry.
	 * - `permission-needed` — home came from "use my location" and the browser
	 *   now refuses it: the card, and search in its place (as weather does).
	 * - doc 08 §5's no-WebGL case — a static card with the coordinates and the
	 *   external link, decided before 300 KB of map are downloaded for nothing.
	 */
	interface Props extends TpWidgetProps {
		/** Test seams: the saved places' Dexie, and the geolocation answers. */
		db?: TpDb | undefined;
		permissionSource?: TpPermissionSource;
		positionSource?: TpPositionSource | undefined;
	}

	let {
		settings: tileSettings,
		onOpenDetail,
		onUpdateSettings,
		db = undefined,
		permissionSource = browserGeoPermission,
		positionSource = undefined
	}: Props = $props();

	const prefs = $derived(readSettings(tileSettings));

	$effect(() => {
		// The saved places, read once per page and shared with the detail.
		void untrack(() => places.load(db));
	});

	let permission = $state<TpGeoPermission | null>(null);

	$effect(() => {
		// Only asked when the reader chose "my location" (as weather does):
		// querying unprompted would be a check nobody requested.
		if (!prefs.useMyLocation) {
			permission = null;
			return;
		}
		let cancelled = false;
		void permissionSource().then((state) => {
			if (!cancelled) permission = state;
		});
		return () => {
			cancelled = true;
		};
	});

	const permissionBlocked = $derived(prefs.useMyLocation && permission === 'denied');

	/** A searched home keeps the geocoder's precision; a located one arrives
	 *  coarse from `core/geolocate` (Week 6 plan S6). */
	function pick(place: TpPlacePick): void {
		onUpdateSettings?.({
			home: { name: place.name, lat: place.lat, lon: place.lon },
			useMyLocation: place.name === ''
		});
	}

	let status = $state<TpMapStatus>('loading');
	/** Bumped by retry, which remounts the map through `{#key}`. */
	let attempt = $state(0);

	function retry(): void {
		status = 'loading';
		attempt += 1;
	}

	const homeName = $derived(
		prefs.home === null || prefs.home.name === '' ? m['widget.map.my_location']() : prefs.home.name
	);

	const pins = $derived.by<TpMapPin[]>(() => {
		const home = prefs.home;
		if (home === null) return [];
		return [
			{ id: 'home', lat: home.lat, lon: home.lon, kind: 'home', label: homeName },
			...places.list.map((place): TpMapPin => ({
				id: place.id,
				lat: place.lat,
				lon: place.lon,
				kind: 'saved',
				label: placeLabel(place)
			}))
		];
	});

	const savedCount = $derived(places.list.length);
</script>

{#if permissionBlocked}
	<div class="tp-map-card" data-testid="map-permission">
		<p class="tp-map-card__line" role="status">
			<TpIcon name="locate" size={13} />
			{m['widget.map.permission_blocked']()}
		</p>
		<TpPlaceSearch onPick={pick} {positionSource} />
	</div>
{:else if prefs.home === null}
	<!-- doc 06 §3's `empty`: first-run guidance with one action — and the
	     privacy notice, shown before anything is asked of OpenFreeMap. -->
	<div class="tp-map-card" data-testid="map-empty">
		<p class="tp-map-card__notice" data-testid="map-notice">
			<TpIcon name="map" size={13} />
			{m['widget.map.privacy_notice']()}
		</p>
		<TpPlaceSearch onPick={pick} {positionSource} />
	</div>
{:else}
	{@const home = prefs.home}
	<div class="tp-map-tile" data-testid="map-tile">
		{#key attempt}
			<TpMap
				lat={home.lat}
				lon={home.lon}
				zoom={HOME_ZOOM}
				interactive={false}
				label={m['widget.map.map_label']({ place: homeName })}
				{pins}
				onStatus={(next) => (status = next)}
			/>
		{/key}

		{#if status === 'loading'}
			<!-- doc 12 §7: a skeleton over the space the map will fill. -->
			<div class="tp-map-tile__skeleton" aria-label={m['widget.map.loading']()}></div>
		{:else if status !== 'ready'}
			<div class="tp-map-tile__card" data-testid="map-fallback" data-reason={status}>
				<p class="tp-map-card__line">
					{#if status === 'no-webgl'}
						{m['widget.map.no_webgl']()}
					{:else if status === 'offline'}
						{m['widget.map.offline']()}
					{:else}
						{m['widget.map.error']()}
					{/if}
				</p>
				<p class="tp-map-card__place">
					<span>{homeName}</span>
					<span class="tp-num">{coordinateText(home.lat, home.lon)}</span>
				</p>
				<span class="tp-map-card__actions">
					<!-- An absolute URL to OpenStreetMap, not a route of this app. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a href={osmUrl(home.lat, home.lon)} target="_blank" rel="noopener noreferrer">
						{m['widget.map.open_osm']()}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{#if status !== 'no-webgl'}
						<button type="button" onclick={retry}>{m['common.retry']()}</button>
					{/if}
				</span>
			</div>
		{:else if onOpenDetail}
			<!-- doc 08 §5: the tile's one interaction is opening the detail. Under
			     the attribution, which stays clickable above it. -->
			<button
				type="button"
				class="tp-map-tile__open"
				aria-label={m['widget.map.open_map']()}
				onclick={() => onOpenDetail?.()}
			></button>
		{/if}

		{#if savedCount > 0 && status === 'ready'}
			<span class="tp-map-tile__chip" data-testid="map-saved-count">
				{m['widget.map.saved_count']({ count: savedCount })}
			</span>
		{/if}
	</div>
{/if}

<style>
	.tp-map-tile {
		position: relative;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		border-radius: var(--radius-ctl);
	}

	.tp-map-tile__skeleton {
		position: absolute;
		inset: 0;
		background: var(--color-ink-850);
	}

	/* Below MapLibre's control corners (z-index 2), so the attribution links
	   stay clickable, and above the canvas. */
	.tp-map-tile__open {
		position: absolute;
		z-index: 1;
		inset: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}

	.tp-map-tile__open:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: -2px;
	}

	.tp-map-tile__chip {
		position: absolute;
		z-index: 2;
		top: 0.375rem;
		left: 0.375rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--color-ink-950) 78%, transparent);
		color: var(--color-fg);
		font-size: var(--text-2xs);
		padding: 0.125rem 0.5rem;
		pointer-events: none;
	}

	.tp-map-tile__card {
		position: absolute;
		z-index: 3;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.375rem;
		background: var(--color-ink-850);
		padding: 0.5rem;
	}

	.tp-map-card {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tp-map-card__notice,
	.tp-map-card__line {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		line-height: 1.45;
	}

	.tp-map-card__notice {
		flex: none;
	}

	.tp-map-card__place {
		display: flex;
		flex-direction: column;
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-xs);
	}

	.tp-map-card__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		font-size: var(--text-xs);
	}

	.tp-map-card__actions a,
	.tp-map-card__actions button {
		border: 0;
		background: transparent;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		padding: 0;
		text-decoration: none;
	}

	.tp-map-card__actions a:focus-visible,
	.tp-map-card__actions button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 2px;
	}
</style>
