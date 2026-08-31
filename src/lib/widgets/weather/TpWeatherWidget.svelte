<script lang="ts">
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpWeatherPlacePicker from './TpWeatherPlacePicker.svelte';
	import TpWeatherReadout from './TpWeatherReadout.svelte';
	import {
		browserGeoPermission,
		type TpPermissionSource,
		type TpPositionSource
	} from './geolocate';
	import { readSettings, weatherKey } from './service';
	import type { TpWeatherPlace } from './types';

	/**
	 * doc 08 §1 — the weather tile, and the first widget in the app to consume
	 * `swr()` (doc 23, Week 4 item 1).
	 *
	 * This half owns the two states `swr` structurally cannot produce (doc 04
	 * §2): `empty`, which is a judgement about whether there is a place at all,
	 * and `permission-needed`, which is a browser state no fetch can see. The
	 * other six live in `TpWeatherReadout`, behind `{#key}` — see its comment
	 * for why that boundary is where it is.
	 *
	 * Both of those states render the same control — the place picker — because
	 * they are the same question after two different answers: nothing chosen
	 * yet, and the browser refusing to choose for you. doc 08 §1 requires
	 * search as the fallback from a denied permission, so the card explains and
	 * then gets out of the way.
	 */
	interface Props extends TpWidgetProps {
		/** Test seams. `db` reaches `swr`; `permissionSource` decides the
		 *  `permission-needed` card without a real browser prompt. */
		db?: TpDb | undefined;
		permissionSource?: TpPermissionSource;
		positionSource?: TpPositionSource | undefined;
	}

	let {
		instanceId,
		settings: tileSettings,
		size,
		onUpdateSettings,
		db = undefined,
		permissionSource = browserGeoPermission,
		positionSource = undefined
	}: Props = $props();

	const prefs = $derived(readSettings(tileSettings));

	/**
	 * The identity of the subscription, and the thing `{#key}` watches.
	 *
	 * It is the data key rather than the coordinates because that is exactly the
	 * granularity that matters: two places inside one ~5 km geohash cell are one
	 * cache entry and one scheduler task (doc 04 §3, doc 04 §5), so moving
	 * between them must not tear down and rebuild anything.
	 */
	const dataKey = $derived(
		prefs.place === null ? null : weatherKey(prefs.place.lat, prefs.place.lon)
	);

	let permission = $state<'granted' | 'denied' | 'prompt' | 'unsupported' | null>(null);

	$effect(() => {
		// Only asked when the reader opted in. Querying unprompted would be a
		// permission check nobody requested, and on some browsers it is itself
		// observable.
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

	/** doc 06 §3's `permission-needed`: asked for, and refused by the browser.
	 *  `unsupported` is not a refusal — search still works, so it stays on the
	 *  ordinary empty path. */
	const permissionBlocked = $derived(prefs.useMyLocation && permission === 'denied');

	/**
	 * doc 06 §2: the widget never writes storage itself; it hands the change to
	 * the host and the deck store owns the round trip. A blank `name` means the
	 * place came from geolocation, which is also the flag that says the reader
	 * opted in — so `useMyLocation` is derived from the pick rather than tracked
	 * separately and left to disagree with it.
	 */
	function pick(place: TpWeatherPlace): void {
		onUpdateSettings?.({ place, useMyLocation: place.name === '' });
	}
</script>

{#if permissionBlocked}
	<!-- doc 06 §3's `permission-needed`. One line of explanation and then the
	     search fallback doc 08 §1 requires — a card that only says "refused"
	     leaves the reader at a dead end the tile can perfectly well get out of. -->
	<div class="tp-wx-card" data-testid="weather-permission">
		<p class="tp-wx-card__line" role="status">
			<TpIcon name="locate" size={13} />
			{m['widget.weather.permission_blocked']()}
		</p>
		<TpWeatherPlacePicker onPick={pick} {positionSource} />
	</div>
{:else if prefs.place === null || dataKey === null}
	<!-- doc 06 §3's `empty`, and the normal first-run state rather than a
	     failure: doc 13 §9 seeds this tile with no place on purpose. The picker
	     *is* this state — a first-run tile that explains itself and offers no
	     control is a chore, not a dashboard. -->
	<div class="tp-wx-card" data-testid="weather-empty">
		<TpWeatherPlacePicker onPick={pick} {positionSource} />
	</div>
{:else}
	<!--
		Remounts the readout when the place moves to another cache cell. Both the
		`swr` subscription and the scheduler registration live inside, and both
		have to be rebuilt together — `useRefresh` snapshots its id at mount and
		`TpGrid.updateTile` swaps props without remounting, so anything less
		leaves the old data key registered and the new one running nothing.
	-->
	{#key dataKey}
		<TpWeatherReadout {instanceId} place={prefs.place} {size} {db} />
	{/key}
{/if}

<style>
	.tp-wx-card {
		display: flex;
		height: 100%;
		min-height: 0;
		flex-direction: column;
		gap: 0.375rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-wx-card__line {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.3rem;
		margin: 0;
		color: var(--color-warn);
	}
</style>
