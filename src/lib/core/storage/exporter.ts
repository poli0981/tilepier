import { isLayout, type TpLayout } from '$lib/core/grid/layout';
import { isSettings, type TpSettings } from '$lib/stores/settings.svelte';
import {
	db,
	type TpDb,
	type TpEvent,
	type TpNote,
	type TpPlaylist,
	type TpSavedPlace,
	type TpTodo,
	type TpTodoList,
	type TpTrack
} from './db';

/**
 * Backup export and import (doc 05 §6), at the path doc 03 §Repo structure
 * gives it.
 *
 * **What is deliberately absent.** `trackBlobs` and `fsaHandles` are never
 * exported: audio bytes would make a backup gigabytes, and a directory handle
 * is a permission grant scoped to one browser profile that means nothing
 * anywhere else. `apiCache` and `fxHistory` are absent too — the first is
 * derivable and pruned on startup anyway (doc 05 §3), and the second is a
 * mirror of a server-side snapshot. A backup is the user's *own* data.
 *
 * This module imports the settings validator from `stores/`, which is a
 * direction `core/` otherwise avoids. The alternative was a second copy of
 * `isSettings` here, which is exactly the drift doc 20 §8's single-source rule
 * exists to prevent — and a validator that disagrees with the writer is worse
 * than an unusual import.
 */

export const BACKUP_VERSION = 1;

/** Only the tables a backup carries. Ordered as doc 05 §6 lists them, so the
 *  summary reads in the same order the spec does. Not exported: callers read
 *  the tables off a summary, and knip is CI-blocking on an export with no
 *  consumer (doc 20 §5). */
const BACKUP_TABLES = [
	'notes',
	'todos',
	'todoLists',
	'events',
	'playlists',
	'tracks',
	'savedPlaces'
] as const;

export type TpBackupTable = (typeof BACKUP_TABLES)[number];

export interface TpBackup {
	meta: { app: 'tilepier'; version: number; exportedAt: string };
	layout: TpLayout;
	settings: TpSettings;
	dexie: {
		notes: TpNote[];
		todos: TpTodo[];
		todoLists: TpTodoList[];
		events: TpEvent[];
		playlists: TpPlaylist[];
		tracks: TpTrack[];
		savedPlaces: TpSavedPlace[];
	};
}

/** `tilepier-backup-20260827.json` (doc 05 §6). Local date, because the file
 *  lands in the user's downloads next to files named by their day. */
export function backupFilename(at: number | Date = Date.now()): string {
	const date = at instanceof Date ? at : new Date(at);
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `tilepier-backup-${date.getFullYear()}${month}${day}.json`;
}

export async function buildBackup(
	layout: TpLayout,
	settings: TpSettings,
	target: TpDb = db
): Promise<TpBackup> {
	const [notes, todos, todoLists, events, playlists, tracks, savedPlaces] = await Promise.all([
		target.notes.toArray(),
		target.todos.toArray(),
		target.todoLists.toArray(),
		target.events.toArray(),
		target.playlists.toArray(),
		target.tracks.toArray(),
		target.savedPlaces.toArray()
	]);

	return {
		meta: {
			app: 'tilepier',
			version: BACKUP_VERSION,
			exportedAt: new Date().toISOString()
		},
		layout,
		settings,
		dexie: { notes, todos, todoLists, events, playlists, tracks, savedPlaces }
	};
}

/* ─────────────────────────────────────────────────────────────── validation */

function isRowArray(value: unknown): value is { id: string }[] {
	return (
		Array.isArray(value) &&
		value.every(
			(row) =>
				typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string'
		)
	);
}

/**
 * doc 05 §6's dry-run validation, hand-written — that section rules out a
 * runtime schema dependency, the same way doc 05 §5 does for localStorage.
 *
 * Deliberately structural rather than exhaustive. It checks what the importer
 * has to *rely on*: the envelope, a version it understands, a layout and a
 * settings block its own validators accept, and tables of objects that all
 * have string ids. A note with an unexpected extra field is not corruption,
 * and refusing the whole file over one would make the feature useless for
 * exactly the person who needs it — someone restoring after something went
 * wrong.
 */
export function isBackup(value: unknown): value is TpBackup {
	if (typeof value !== 'object' || value === null) return false;
	const backup = value as Record<string, unknown>;

	const meta = backup['meta'];
	if (typeof meta !== 'object' || meta === null) return false;
	const stamp = meta as Record<string, unknown>;
	if (stamp['app'] !== 'tilepier') return false;
	// A file from a newer build may hold shapes this one cannot read. Refusing
	// it is the same call doc 05 §5 makes for a downgraded localStorage key.
	if (typeof stamp['version'] !== 'number' || stamp['version'] > BACKUP_VERSION) return false;

	if (!isLayout(backup['layout'])) return false;
	if (!isSettings(backup['settings'])) return false;

	const dexie = backup['dexie'];
	if (typeof dexie !== 'object' || dexie === null) return false;
	const tables = dexie as Record<string, unknown>;

	return BACKUP_TABLES.every((name) => isRowArray(tables[name]));
}

/** Parses and validates a file's text in one step, so a caller has one thing
 *  to check rather than two. */
export function readBackup(text: string): TpBackup | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	return isBackup(parsed) ? parsed : null;
}

/* ──────────────────────────────────────────────────────────────── importing */

export type TpImportMode = 'merge' | 'replace';

interface TpTableSummary {
	table: TpBackupTable;
	/** Rows in the file. */
	incoming: number;
	/** Rows that would be created. */
	added: number;
	/** Rows that exist and would be overwritten, because the file's copy is
	 *  newer. Always 0 in `replace`, where everything is written. */
	updated: number;
	/** Rows that exist and would be left alone. */
	unchanged: number;
}

export interface TpImportSummary {
	mode: TpImportMode;
	tables: TpTableSummary[];
	/** Totals, so the confirm line does not have to add up seven numbers. */
	added: number;
	updated: number;
}

function updatedAtOf(row: unknown): number | null {
	if (typeof row !== 'object' || row === null) return null;
	const value = (row as { updatedAt?: unknown }).updatedAt;
	return typeof value === 'number' ? value : null;
}

/**
 * What an import would do, without doing it (doc 05 §6's dry run).
 *
 * The merge rule is "newer `updatedAt` wins", which only three of the seven
 * tables carry. For the rest — lists, playlists, tracks, saved places, events —
 * an existing row is left alone and only missing ones are added. That is the
 * non-destructive reading of a non-destructive default: without a timestamp
 * there is no evidence the file's copy is newer, and overwriting on no
 * evidence is how a restore quietly undoes an afternoon's work.
 */
export async function summariseImport(
	backup: TpBackup,
	mode: TpImportMode,
	target: TpDb = db
): Promise<TpImportSummary> {
	const tables: TpTableSummary[] = [];

	for (const name of BACKUP_TABLES) {
		const incoming = backup.dexie[name] as { id: string }[];
		const existing = await target.table(name).toArray();
		const byId = new Map(existing.map((row) => [(row as { id: string }).id, row]));

		let added = 0;
		let updated = 0;
		let unchanged = 0;

		for (const row of incoming) {
			const current = byId.get(row.id);
			if (current === undefined) {
				added += 1;
				continue;
			}
			if (mode === 'replace') {
				updated += 1;
				continue;
			}

			const incomingAt = updatedAtOf(row);
			const currentAt = updatedAtOf(current);
			if (incomingAt !== null && currentAt !== null && incomingAt > currentAt) updated += 1;
			else unchanged += 1;
		}

		tables.push({ table: name, incoming: incoming.length, added, updated, unchanged });
	}

	return {
		mode,
		tables,
		added: tables.reduce((sum, row) => sum + row.added, 0),
		updated: tables.reduce((sum, row) => sum + row.updated, 0)
	};
}

export interface TpImportResult {
	summary: TpImportSummary;
	layout: TpLayout;
	settings: TpSettings;
}

/**
 * Applies a backup.
 *
 * Returns the layout and settings rather than writing them: those live in
 * localStorage behind their own stores, and a module in `core/storage` reaching
 * into `deck` and `settings` to write them would put the same data behind two
 * doors. The caller — which already holds both stores — puts them where they
 * go, and `replace` is the only mode that hands them back at all.
 *
 * The Dexie half **is** written here, in one transaction per table set, so a
 * failure halfway does not leave a half-restored database.
 */
export async function applyImport(
	backup: TpBackup,
	mode: TpImportMode,
	target: TpDb = db
): Promise<TpImportResult> {
	const summary = await summariseImport(backup, mode, target);

	await target.transaction(
		'rw',
		[
			target.notes,
			target.todos,
			target.todoLists,
			target.events,
			target.playlists,
			target.tracks,
			target.savedPlaces
		],
		async () => {
			for (const name of BACKUP_TABLES) {
				const table = target.table(name);
				const incoming = backup.dexie[name] as { id: string }[];

				if (mode === 'replace') {
					await table.clear();
					if (incoming.length > 0) await table.bulkPut(incoming);
					continue;
				}

				const existing = await table.toArray();
				const byId = new Map(existing.map((row) => [(row as { id: string }).id, row]));

				const writes = incoming.filter((row) => {
					const current = byId.get(row.id);
					if (current === undefined) return true;

					const incomingAt = updatedAtOf(row);
					const currentAt = updatedAtOf(current);
					return incomingAt !== null && currentAt !== null && incomingAt > currentAt;
				});

				if (writes.length > 0) await table.bulkPut(writes);
			}
		}
	);

	return { summary, layout: backup.layout, settings: backup.settings };
}
