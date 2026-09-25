<script lang="ts">
	import { untrack } from 'svelte';
	import { copyText } from '$lib/core/clipboard';
	import type { TpPlacePick } from '$lib/core/geocode';
	import type { TpPositionSource } from '$lib/core/geolocate';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtDistance } from '$lib/i18n/fmt';
	import TpMap, { type TpMapCamera, type TpMapPin, type TpMapStatus } from '$lib/map/TpMap.svelte';
	import { googleMapsUrl, osmUrl } from '$lib/map/styles';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpPlaceSearch from '$lib/ui/TpPlaceSearch.svelte';
	import { places } from './places.svelte';
	import { coordinateText, placeLabel, placeRows, PLACE_NAME_MAX, readSettings } from './service';
	import { HOME_ZOOM, NO_HOME } from './types';

	/**
	 * doc 08 §5's detail: the map that moves, and the places on it.
	 *
	 * Search → a pin → save it (named as the reader likes) or make it home;
	 * the saved list nearest-to-home first, each place one click from the map,
	 * its coordinates one click from the clipboard, and OpenStreetMap or Google
	 * Maps one click away for what this app does not do — routes, opening hours,
	 * anything with an API bill (doc 08 §5: no directions in v1).
	 *
	 * The map is removed with this component (`TpMap`'s `map.remove()`), which is
	 * doc 08 §5's "WebGL context released on detail close".
	 */
	interface Props extends TpDetailProps {
		/** Test seams: the saved places' Dexie, and the geolocation answer. */
		db?: TpDb | undefined;
		positionSource?: TpPositionSource | undefined;
	}

	let {
		settings: tileSettings,
		onUpdateSettings,
		db = undefined,
		positionSource = undefined
	}: Props = $props();

	const prefs = $derived(readSettings(tileSettings));

	$effect(() => {
		// The saved places, shared with the tile; read once per page.
		void untrack(() => places.load(db));
	});

	/** Where the map starts. Only its first value matters: after that the camera
	 *  moves by `flyTo`, and the reader by hand. */
	const start = untrack(() =>
		prefs.home === null ? NO_HOME : { lat: prefs.home.lat, lon: prefs.home.lon, zoom: HOME_ZOOM }
	);

	let camera: TpMapCamera | null = null;
	let status = $state<TpMapStatus>('loading');
	let attempt = $state(0);

	/** The search's answer, until it is saved, made home, or replaced. */
	let found = $state<TpPlacePick | null>(null);
	let foundName = $state('');
	/** The saved place the reader last pointed at, on the map or in the list. */
	let selected = $state<string | null>(null);
	let renaming = $state<string | null>(null);
	let renameDraft = $state('');
	/** Which "copy" last succeeded, for its one-and-a-half-second "copied". */
	let copied = $state<string | null>(null);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		return () => {
			if (copyTimer !== null) clearTimeout(copyTimer);
		};
	});

	const homeName = $derived(
		prefs.home === null || prefs.home.name === '' ? m['widget.map.my_location']() : prefs.home.name
	);

	const rows = $derived(placeRows(places.list, prefs.home, settings.locale));

	const pins = $derived.by<TpMapPin[]>(() => {
		const list: TpMapPin[] = rows.map(({ place }) => ({
			id: place.id,
			lat: place.lat,
			lon: place.lon,
			kind: 'saved',
			label: placeLabel(place)
		}));
		if (prefs.home !== null) {
			list.unshift({
				id: 'home',
				lat: prefs.home.lat,
				lon: prefs.home.lon,
				kind: 'home',
				label: homeName
			});
		}
		if (found !== null) {
			list.push({
				id: 'found',
				lat: found.lat,
				lon: found.lon,
				kind: 'found',
				label: found.name === '' ? m['widget.map.my_location']() : found.name
			});
		}
		return list;
	});

	function show(lat: number, lon: number): void {
		camera?.flyTo(lat, lon, 15);
	}

	function onFound(place: TpPlacePick): void {
		found = place;
		foundName = place.name;
		selected = null;
		show(place.lat, place.lon);
	}

	async function save(): Promise<void> {
		if (found === null) return;
		const saved = await places.add(
			{ name: foundName.trim() === '' ? found.name : foundName, lat: found.lat, lon: found.lon },
			db
		);
		found = null;
		selected = saved.id;
	}

	/** A searched home keeps its precision; a located one is coarse already. */
	function makeHome(place: { name: string; lat: number; lon: number }): void {
		onUpdateSettings?.({
			home: { name: place.name, lat: place.lat, lon: place.lon },
			useMyLocation: place.name === ''
		});
		if (found !== null && found.lat === place.lat && found.lon === place.lon) found = null;
	}

	function startRename(id: string, name: string): void {
		renaming = id;
		renameDraft = name;
	}

	async function finishRename(id: string): Promise<void> {
		if (renaming !== id) return;
		renaming = null;
		await places.rename(id, renameDraft, db);
	}

	async function copy(key: string, lat: number, lon: number): Promise<void> {
		if (!(await copyText(coordinateText(lat, lon)))) return;
		copied = key;
		if (copyTimer !== null) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = null), 1500);
	}

	function onPin(id: string): void {
		if (id === 'home' || id === 'found') return;
		selected = id;
		document.getElementById(`tp-mapd-${id}`)?.scrollIntoView({ block: 'nearest' });
	}

	function retry(): void {
		status = 'loading';
		attempt += 1;
	}
</script>

{#snippet links(key: string, lat: number, lon: number, name: string)}
	<span class="tp-mapd__links">
		<button
			type="button"
			class="tp-mapd__link"
			onclick={() => void copy(key, lat, lon)}
			aria-label={m['widget.map.copy_label']({ place: name })}
		>
			{copied === key ? m['widget.map.copied']() : m['widget.map.copy']()}
		</button>
		<!-- Absolute URLs to OpenStreetMap and Google Maps, not routes of this app. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a class="tp-mapd__link" href={osmUrl(lat, lon)} target="_blank" rel="noopener noreferrer">
			{m['widget.map.open_osm']()}
		</a>
		<a
			class="tp-mapd__link"
			href={googleMapsUrl(lat, lon)}
			target="_blank"
			rel="noopener noreferrer"
		>
			{m['widget.map.open_google']()}
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</span>
{/snippet}

<div class="tp-mapd">
	<div class="tp-mapd__layout">
		<div class="tp-mapd__map">
			{#key attempt}
				<TpMap
					lat={start.lat}
					lon={start.lon}
					zoom={start.zoom}
					interactive={true}
					label={m['widget.map.map_label']({ place: homeName })}
					{pins}
					onStatus={(next) => (status = next)}
					{onPin}
					onCamera={(next) => (camera = next)}
				/>
			{/key}
			{#if status === 'loading'}
				<div class="tp-mapd__veil" aria-label={m['widget.map.loading']()}></div>
			{:else if status !== 'ready'}
				<div
					class="tp-mapd__veil tp-mapd__veil--card"
					data-testid="mapd-fallback"
					data-reason={status}
				>
					<p>
						{#if status === 'no-webgl'}
							{m['widget.map.no_webgl']()}
						{:else if status === 'offline'}
							{m['widget.map.offline']()}
						{:else}
							{m['widget.map.error']()}
						{/if}
					</p>
					{#if status !== 'no-webgl'}
						<button type="button" class="tp-mapd__link" onclick={retry}
							>{m['common.retry']()}</button
						>
					{/if}
				</div>
			{/if}
		</div>

		<div class="tp-mapd__panel">
			<TpPlaceSearch onPick={onFound} {positionSource} />

			{#if found !== null}
				{@const place = found}
				<section
					class="tp-mapd__card"
					aria-label={m['widget.map.found_heading']()}
					data-testid="mapd-found"
				>
					<label class="tp-mapd__name">
						<span>{m['widget.map.name_label']()}</span>
						<input
							type="text"
							bind:value={foundName}
							maxlength={PLACE_NAME_MAX}
							placeholder={place.name === '' ? m['widget.map.my_location']() : place.name}
						/>
					</label>
					{#if place.context !== ''}
						<p class="tp-mapd__context">{place.context}</p>
					{/if}
					<p class="tp-mapd__coords tp-num">{coordinateText(place.lat, place.lon)}</p>
					<span class="tp-mapd__actions">
						<button
							type="button"
							class="tp-mapd__primary"
							onclick={() => void save()}
							data-testid="mapd-save"
						>
							{m['widget.map.save']()}
						</button>
						<button
							type="button"
							class="tp-mapd__link"
							onclick={() =>
								makeHome({
									name: foundName.trim() === '' ? place.name : foundName.trim(),
									lat: place.lat,
									lon: place.lon
								})}
						>
							{m['widget.map.make_home']()}
						</button>
					</span>
					{@render links('found', place.lat, place.lon, place.name)}
				</section>
			{/if}

			<section class="tp-mapd__section" aria-labelledby="tp-mapd-home">
				<h3 id="tp-mapd-home" class="tp-mapd__heading">{m['widget.map.home_heading']()}</h3>
				{#if prefs.home === null}
					<p class="tp-mapd__note">{m['widget.map.no_home']()}</p>
				{:else}
					{@const home = prefs.home}
					<button type="button" class="tp-mapd__place" onclick={() => show(home.lat, home.lon)}>
						<span class="tp-mapd__place-name">{homeName}</span>
						<span class="tp-mapd__coords tp-num">{coordinateText(home.lat, home.lon)}</span>
					</button>
					{@render links('home', home.lat, home.lon, homeName)}
				{/if}
			</section>

			<section class="tp-mapd__section" aria-labelledby="tp-mapd-saved">
				<h3 id="tp-mapd-saved" class="tp-mapd__heading">{m['widget.map.saved_heading']()}</h3>
				{#if rows.length === 0}
					<p class="tp-mapd__note">{m['widget.map.saved_none']()}</p>
				{:else}
					<ul class="tp-mapd__list" data-testid="mapd-saved">
						{#each rows as { place, km } (place.id)}
							{@const name = placeLabel(place)}
							<li
								id="tp-mapd-{place.id}"
								class="tp-mapd__row"
								class:tp-mapd__row--on={selected === place.id}
							>
								{#if renaming === place.id}
									<input
										class="tp-mapd__rename"
										type="text"
										bind:value={renameDraft}
										maxlength={PLACE_NAME_MAX}
										aria-label={m['widget.map.rename_label']({ place: name })}
										onkeydown={(event) => {
											if (event.key === 'Enter') void finishRename(place.id);
											if (event.key === 'Escape') renaming = null;
										}}
										onblur={() => void finishRename(place.id)}
									/>
								{:else}
									<button
										type="button"
										class="tp-mapd__place"
										onclick={() => {
											selected = place.id;
											show(place.lat, place.lon);
										}}
									>
										<span class="tp-mapd__place-name">{name}</span>
										{#if km !== null}
											<span class="tp-mapd__distance tp-num">
												{m['widget.map.distance']({ distance: fmtDistance(km, settings.locale) })}
											</span>
										{/if}
									</button>
								{/if}
								<span class="tp-mapd__tools">
									<button
										type="button"
										class="tp-mapd__tool"
										aria-label={m['widget.map.rename']({ place: name })}
										title={m['widget.map.rename']({ place: name })}
										onclick={() => startRename(place.id, place.name)}
									>
										<TpIcon name="edit" size={12} />
									</button>
									<button
										type="button"
										class="tp-mapd__tool"
										aria-label={m['widget.map.make_home_named']({ place: name })}
										title={m['widget.map.make_home_named']({ place: name })}
										onclick={() => makeHome(place)}
									>
										<TpIcon name="locate" size={12} />
									</button>
									<button
										type="button"
										class="tp-mapd__tool"
										aria-label={m['widget.map.remove']({ place: name })}
										title={m['widget.map.remove']({ place: name })}
										onclick={() => void places.remove(place.id, db)}
									>
										<TpIcon name="trash" size={12} />
									</button>
								</span>
								{#if selected === place.id}
									{@render links(place.id, place.lat, place.lon, name)}
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>
	</div>
</div>

<style>
	.tp-mapd {
		height: 100%;
		min-height: 0;
		container-type: inline-size;
	}

	.tp-mapd__layout {
		display: grid;
		height: 100%;
		min-height: 0;
		grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);
		gap: 1rem;
	}

	.tp-mapd__map {
		position: relative;
		min-height: 18rem;
		overflow: hidden;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
	}

	.tp-mapd__veil {
		position: absolute;
		z-index: 3;
		inset: 0;
		background: var(--color-ink-850);
	}

	.tp-mapd__veil--card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		padding: 1rem;
		text-align: center;
	}

	.tp-mapd__veil--card p {
		margin: 0;
	}

	.tp-mapd__panel {
		display: flex;
		min-height: 0;
		flex-direction: column;
		gap: 1rem;
		overflow-y: auto;
	}

	.tp-mapd__section,
	.tp-mapd__card {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.tp-mapd__card {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		padding: 0.625rem;
	}

	.tp-mapd__heading {
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.tp-mapd__name {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mapd__name input,
	.tp-mapd__rename {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		padding: 0.3rem 0.5rem;
	}

	.tp-mapd__name input:focus-visible,
	.tp-mapd__rename:focus-visible {
		border-color: var(--color-beacon);
		outline: none;
	}

	.tp-mapd__context,
	.tp-mapd__note {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mapd__coords {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-mapd__actions,
	.tp-mapd__links {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}

	.tp-mapd__primary {
		border: 0;
		border-radius: var(--radius-ctl);
		background: var(--color-beacon);
		color: var(--color-ink-950);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 0.3rem 0.75rem;
	}

	.tp-mapd__link {
		border: 0;
		background: transparent;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		padding: 0;
		text-decoration: none;
	}

	.tp-mapd__primary:focus-visible,
	.tp-mapd__link:focus-visible,
	.tp-mapd__place:focus-visible,
	.tp-mapd__tool:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 2px;
	}

	.tp-mapd__list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-mapd__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		border-radius: var(--radius-ctl);
		padding: 0.25rem 0.375rem;
	}

	.tp-mapd__row--on {
		background: var(--color-beacon-soft);
	}

	.tp-mapd__place {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		align-items: flex-start;
		border: 0;
		background: transparent;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0;
		text-align: left;
	}

	.tp-mapd__place-name {
		overflow: hidden;
		max-width: 100%;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mapd__distance {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mapd__rename {
		min-width: 0;
		flex: 1;
	}

	.tp-mapd__tools {
		display: inline-flex;
		flex: none;
	}

	.tp-mapd__tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg-dim);
		cursor: pointer;
		padding: 0.25rem;
	}

	.tp-mapd__tool:hover {
		color: var(--color-fg);
	}

	.tp-mapd__row .tp-mapd__links {
		flex-basis: 100%;
	}

	/* Stacked on a narrow screen: the map above, the places below it. */
	@container (max-width: 720px) {
		.tp-mapd__layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: minmax(16rem, 55%) minmax(0, 1fr);
		}
	}
</style>
