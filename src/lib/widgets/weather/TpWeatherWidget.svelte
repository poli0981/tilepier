<script lang="ts">
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpWeatherReadout from './TpWeatherReadout.svelte';
	import { browserGeoPermission, type TpPermissionSource } from './geolocate';
	import { readSettings, weatherKey } from './service';

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
	 * The place picker itself is the next commit. Until it lands the empty card
	 * says what to do without offering the control, which is visible on the
	 * first-run deck (doc 13 §9 seeds a weather tile deliberately empty) and is
	 * why the two commits belong to one PR.
	 */
	interface Props extends TpWidgetProps {
		/** Test seams. `db` reaches `swr`; `permissionSource` decides the
		 *  `permission-needed` card without a real browser prompt. */
		db?: TpDb | undefined;
		permissionSource?: TpPermissionSource;
	}

	let {
		settings: tileSettings,
		size,
		db = undefined,
		permissionSource = browserGeoPermission
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
</script>

{#if permissionBlocked}
	<div class="tp-wx-card" role="status" data-testid="weather-permission">
		<TpIcon name="map" size={18} />
		<p>{m['widget.weather.permission_blocked']()}</p>
		<p class="tp-wx-card__hint">{m['widget.weather.permission_hint']()}</p>
	</div>
{:else if prefs.place === null || dataKey === null}
	<!-- doc 06 §3's `empty`, and the normal first-run state rather than a
	     failure: doc 13 §9 seeds this tile with no place on purpose. -->
	<div class="tp-wx-card" data-testid="weather-empty">
		<TpIcon name="cloud" size={18} />
		<p>{m['widget.weather.empty']()}</p>
		<p class="tp-wx-card__hint">{m['widget.weather.empty_hint']()}</p>
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
		<TpWeatherReadout place={prefs.place} {size} {db} />
	{/key}
{/if}

<style>
	.tp-wx-card {
		display: flex;
		height: 100%;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 0.25rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-wx-card p {
		margin: 0;
	}

	.tp-wx-card__hint {
		color: var(--color-fg-dim);
	}
</style>
