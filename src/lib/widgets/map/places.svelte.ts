import { db as defaultDb, type TpDb, type TpSavedPlace } from '$lib/core/storage/db';
import { logEntry } from '$lib/core/log-buffer';
import { PLACE_NAME_MAX, readPlace } from './service';

/**
 * The saved places, one list for the tile and the detail (doc 08 §5).
 *
 * **A store because two components read one table.** The repo does not use
 * `liveQuery`, and a component that read Dexie once on mount — the way the
 * notes tile does — would leave the tile's "N saved" chip behind the moment the
 * detail saved a place (Week 6 plan, M3). One module-level list, loaded once
 * and written through, keeps them in step with no subscription to manage.
 *
 * Dexie's `savedPlaces` table has existed since version 1 (doc 05 §3), so this
 * needs no schema change.
 */
class TpPlaces {
	/** Replaced on every write, never mutated: the components derive from it. */
	list = $state.raw<readonly TpSavedPlace[]>([]);
	loaded = $state(false);

	#loading: Promise<void> | null = null;

	/** Reads the table once per page; later calls share that read. */
	load(target: TpDb = defaultDb): Promise<void> {
		this.#loading ??= target.savedPlaces
			.toArray()
			.then((rows) => {
				this.list = rows.flatMap((row) => {
					const place = readPlace(row);
					return place === null ? [] : [place];
				});
			})
			.catch((error: unknown) => {
				// Fail closed (doc 05 §5): no list, not a crashed tile. Nothing about
				// the places goes in the log — they are where the reader goes.
				logEntry('warn', 'saved places could not be read', { src: 'widget', error });
				this.list = [];
			})
			.finally(() => {
				this.loaded = true;
			});
		return this.#loading;
	}

	async add(
		place: { name: string; lat: number; lon: number },
		target: TpDb = defaultDb
	): Promise<TpSavedPlace> {
		const saved: TpSavedPlace = {
			id: crypto.randomUUID(),
			name: place.name.trim().slice(0, PLACE_NAME_MAX),
			lat: place.lat,
			lon: place.lon
		};
		await target.savedPlaces.put(saved);
		this.list = [...this.list, saved];
		return saved;
	}

	async rename(id: string, name: string, target: TpDb = defaultDb): Promise<void> {
		const next = name.trim().slice(0, PLACE_NAME_MAX);
		await target.savedPlaces.update(id, { name: next });
		this.list = this.list.map((place) => (place.id === id ? { ...place, name: next } : place));
	}

	async remove(id: string, target: TpDb = defaultDb): Promise<void> {
		await target.savedPlaces.delete(id);
		this.list = this.list.filter((place) => place.id !== id);
	}

	/** Test seam: forget the list and the read. Never called in production. */
	reset(): void {
		this.list = [];
		this.loaded = false;
		this.#loading = null;
	}
}

export const places = new TpPlaces();
