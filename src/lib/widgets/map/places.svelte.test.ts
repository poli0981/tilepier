import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { places } from './places.svelte';

/**
 * The saved-places store against a throwaway Dexie (browser project, for
 * IndexedDB).
 */

let db: TpDb;

beforeEach(() => {
	places.reset();
	db = createDb(`tilepier-places-${crypto.randomUUID()}`);
});

afterEach(async () => {
	places.reset();
	db.close();
	await db.delete();
});

describe('places', () => {
	it('reads the table once, and drops rows no map could draw', async () => {
		await db.savedPlaces.bulkPut([
			{ id: 'a', name: 'Hồ Gươm', lat: 21.0287, lon: 105.8524 },
			// What a hand-edited backup can carry past the importer.
			{ id: 'b', name: 'broken', lat: Number.NaN, lon: 105 }
		]);

		await places.load(db);

		expect(places.loaded).toBe(true);
		expect(places.list.map((place) => place.id)).toEqual(['a']);
	});

	it('writes through: add, rename and remove reach Dexie and the list together', async () => {
		await places.load(db);

		const saved = await places.add({ name: '  Văn Miếu  ', lat: 21.0277, lon: 105.8355 }, db);
		expect(saved.name).toBe('Văn Miếu');
		expect(places.list).toHaveLength(1);
		expect(await db.savedPlaces.get(saved.id)).toMatchObject({ name: 'Văn Miếu' });

		await places.rename(saved.id, 'Quốc Tử Giám', db);
		expect(places.list[0]?.name).toBe('Quốc Tử Giám');
		expect((await db.savedPlaces.get(saved.id))?.name).toBe('Quốc Tử Giám');

		await places.remove(saved.id, db);
		expect(places.list).toHaveLength(0);
		expect(await db.savedPlaces.count()).toBe(0);
	});

	it('shares one read between the tile and the detail', async () => {
		await db.savedPlaces.put({ id: 'a', name: 'x', lat: 0, lon: 0 });

		const first = places.load(db);
		const second = places.load(db);

		expect(second).toBe(first);
		await first;
	});
});
