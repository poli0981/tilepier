import { afterEach, describe, expect, it } from 'vitest';
import type { TpLayout } from '$lib/core/grid/layout';
import { defaultSettings } from '$lib/stores/settings.svelte';
import { createDb, type TpDb } from './db';
import {
	BACKUP_VERSION,
	applyImport,
	backupFilename,
	buildBackup,
	isBackup,
	readBackup,
	summariseImport,
	type TpBackup
} from './exporter';

/**
 * doc 05 §6, and doc 19 §4's journey #6 in unit form: export, wipe, import,
 * and the merge rule in between.
 *
 * Browser project — the `.svelte.` infix selects it (doc 19 §1) — for real
 * IndexedDB, against a throwaway database.
 */

const created: TpDb[] = [];

function freshDb(): TpDb {
	const db = createDb(`tilepier-backup-${crypto.randomUUID()}`);
	created.push(db);
	return db;
}

const LAYOUT: TpLayout = {
	schemaVersion: 1,
	grid: [{ instanceId: 'wgt_a', widgetId: 'clock', x: 0, y: 0, w: 3, h: 2, settings: {} }]
};

afterEach(async () => {
	// Closed before deleted: several of these cases hold two databases open at
	// once (a source to export from and a target to import into), and Dexie
	// warns `delete() was blocked` when a live connection is still attached.
	while (created.length > 0) {
		const db = created.pop();
		db?.close();
		await db?.delete();
	}
});

async function seed(db: TpDb): Promise<void> {
	await db.notes.add({ id: 'note_1', title: 'One', body: 'first', updatedAt: 100 });
	await db.todoLists.add({ id: 'list_1', name: 'Errands', order: 0 });
	await db.todos.add({
		id: 'todo_1',
		listId: 'list_1',
		text: 'milk',
		done: false,
		updatedAt: 100
	});
	await db.savedPlaces.add({ id: 'place_1', name: 'Home', lat: 21, lon: 105 });
}

describe('the file', () => {
	it('is named for the local day', () => {
		expect(backupFilename(new Date(2026, 7, 27, 23, 30))).toBe('tilepier-backup-20260827.json');
		expect(backupFilename(new Date(2026, 0, 5))).toBe('tilepier-backup-20260105.json');
	});

	it('carries the envelope, the layout, the settings and the tables', async () => {
		const db = freshDb();
		await seed(db);

		const backup = await buildBackup(LAYOUT, defaultSettings(), db);

		expect(backup.meta.app).toBe('tilepier');
		expect(backup.meta.version).toBe(BACKUP_VERSION);
		expect(backup.layout).toEqual(LAYOUT);
		expect(backup.dexie.notes).toHaveLength(1);
		expect(backup.dexie.todos).toHaveLength(1);
		expect(backup.dexie.savedPlaces).toHaveLength(1);
	});

	it('never carries audio bytes or folder handles', async () => {
		// doc 05 §6: size, and a permission grant that means nothing on another
		// device. `apiCache` and `fxHistory` are absent for their own reasons.
		const db = freshDb();
		const backup = (await buildBackup(LAYOUT, defaultSettings(), db)) as unknown as Record<
			string,
			unknown
		>;
		const tables = Object.keys(backup['dexie'] as object);

		expect(tables).not.toContain('trackBlobs');
		expect(tables).not.toContain('fsaHandles');
		expect(tables).not.toContain('apiCache');
		expect(tables).not.toContain('fxHistory');
	});

	it('survives a round trip through JSON', async () => {
		const db = freshDb();
		await seed(db);

		const backup = await buildBackup(LAYOUT, defaultSettings(), db);
		const parsed = readBackup(JSON.stringify(backup));

		expect(parsed).toEqual(backup);
	});
});

describe('validation', () => {
	async function sample(): Promise<TpBackup> {
		const db = freshDb();
		await seed(db);
		return buildBackup(LAYOUT, defaultSettings(), db);
	}

	it('accepts what it wrote', async () => {
		expect(isBackup(await sample())).toBe(true);
	});

	it('rejects anything that is not a backup', () => {
		expect(isBackup(null)).toBe(false);
		expect(isBackup('{}')).toBe(false);
		expect(isBackup({})).toBe(false);
		expect(isBackup({ meta: { app: 'something-else', version: 1 } })).toBe(false);
	});

	it('rejects a file from a newer build', async () => {
		// The same call doc 05 §5 makes for a downgraded localStorage key: a
		// shape this build has never seen is not something to guess at.
		const backup = await sample();
		expect(isBackup({ ...backup, meta: { ...backup.meta, version: 99 } })).toBe(false);
	});

	it('rejects a broken layout or settings block', async () => {
		const backup = await sample();
		expect(isBackup({ ...backup, layout: { schemaVersion: 9, grid: [] } })).toBe(false);
		expect(isBackup({ ...backup, settings: { schemaVersion: 1 } })).toBe(false);
	});

	it('rejects a table that is not rows with ids', async () => {
		const backup = await sample();
		expect(isBackup({ ...backup, dexie: { ...backup.dexie, notes: 'nope' } })).toBe(false);
		expect(isBackup({ ...backup, dexie: { ...backup.dexie, notes: [{ title: 'no id' }] } })).toBe(
			false
		);
	});

	it('rejects text that is not JSON at all', () => {
		expect(readBackup('not json')).toBeNull();
		expect(readBackup('')).toBeNull();
	});
});

describe('merge — the non-destructive default', () => {
	async function withBackup(): Promise<{ source: TpDb; target: TpDb; backup: TpBackup }> {
		const source = freshDb();
		await seed(source);
		const backup = await buildBackup(LAYOUT, defaultSettings(), source);
		return { source, target: freshDb(), backup };
	}

	it('restores everything into an empty database', async () => {
		const { target, backup } = await withBackup();

		const result = await applyImport(backup, 'merge', target);

		expect(result.summary.added).toBe(4);
		expect(result.summary.updated).toBe(0);
		expect(await target.notes.count()).toBe(1);
		expect(await target.todos.count()).toBe(1);
	});

	it('takes the file’s copy when it is newer', async () => {
		const { target, backup } = await withBackup();
		await target.notes.add({ id: 'note_1', title: 'Old', body: 'stale', updatedAt: 1 });

		await applyImport(backup, 'merge', target);

		expect((await target.notes.get('note_1'))?.body).toBe('first');
	});

	it('keeps this device’s copy when it is newer', async () => {
		// The case that makes "merge" safe to press: a restore from an old file
		// must not undo today's edits.
		const { target, backup } = await withBackup();
		await target.notes.add({ id: 'note_1', title: 'Newer', body: 'edited today', updatedAt: 999 });

		const result = await applyImport(backup, 'merge', target);

		expect((await target.notes.get('note_1'))?.body).toBe('edited today');
		expect(result.summary.updated).toBe(0);
	});

	it('leaves a row with no timestamp alone rather than guessing', async () => {
		// `savedPlaces` carries no `updatedAt`, so there is no evidence the
		// file's copy is newer — and overwriting on no evidence is how a restore
		// quietly undoes an afternoon's work.
		const { target, backup } = await withBackup();
		await target.savedPlaces.add({ id: 'place_1', name: 'Renamed', lat: 1, lon: 2 });

		await applyImport(backup, 'merge', target);

		expect((await target.savedPlaces.get('place_1'))?.name).toBe('Renamed');
	});

	it('never deletes anything the file does not mention', async () => {
		const { target, backup } = await withBackup();
		await target.notes.add({ id: 'note_local', title: 'Mine', body: 'kept', updatedAt: 5 });

		await applyImport(backup, 'merge', target);

		expect(await target.notes.count()).toBe(2);
		expect((await target.notes.get('note_local'))?.body).toBe('kept');
	});

	it('reports what it would do before doing it', async () => {
		// doc 05 §6's dry run: the summary is computed without writing.
		const { target, backup } = await withBackup();

		const preview = await summariseImport(backup, 'merge', target);

		expect(preview.added).toBe(4);
		expect(await target.notes.count()).toBe(0);
	});
});

describe('replace', () => {
	it('throws away what is here and restores the file exactly', async () => {
		const source = freshDb();
		await seed(source);
		const backup = await buildBackup(LAYOUT, defaultSettings(), source);

		const target = freshDb();
		await target.notes.add({ id: 'note_local', title: 'Mine', body: 'gone', updatedAt: 999 });

		await applyImport(backup, 'replace', target);

		expect(await target.notes.count()).toBe(1);
		expect(await target.notes.get('note_local')).toBeUndefined();
		expect((await target.notes.get('note_1'))?.body).toBe('first');
	});

	it('hands back the layout and settings for the caller to apply', async () => {
		// They live in localStorage behind their own stores; a module in
		// core/storage writing them would put the same data behind two doors.
		const source = freshDb();
		const backup = await buildBackup(LAYOUT, defaultSettings(), source);

		const result = await applyImport(backup, 'replace', freshDb());

		expect(result.layout).toEqual(LAYOUT);
		expect(result.settings.schemaVersion).toBe(1);
	});

	it('empties a table the file has nothing for', async () => {
		const source = freshDb();
		const backup = await buildBackup(LAYOUT, defaultSettings(), source);

		const target = freshDb();
		await target.notes.add({ id: 'note_local', title: 'Mine', body: 'gone', updatedAt: 1 });

		await applyImport(backup, 'replace', target);

		expect(await target.notes.count()).toBe(0);
	});
});
