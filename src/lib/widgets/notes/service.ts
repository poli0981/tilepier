import { newId } from '$lib/core/ids';
import { db, type TpDb, type TpNote } from '$lib/core/storage/db';
import { foldForSearch } from '$lib/i18n/fold';

/**
 * doc 07 §4's data layer. Dexie in, plain objects out; nothing here knows what
 * a component is.
 *
 * `target` defaults to the singleton and is a parameter for the same reason
 * `pruneApiCache` takes one — so the behaviour can be checked against a
 * throwaway database rather than against the user's own notes.
 */

/** Long enough for a real sentence, short enough to fit a sidebar row. */
const MAX_TITLE = 80;

/**
 * The title is derived from the body and *stored*, rather than being a field
 * the user maintains separately.
 *
 * Two reasons. A markdown note's first line already is its title, and asking
 * for it twice is asking the user to keep two things in sync. And doc 05 §3
 * indexes `notes` on `id, updatedAt` only — so a sidebar that showed derived
 * titles would have to load every body to render a list, which is exactly the
 * work an index exists to avoid.
 */
export function titleOf(body: string): string {
	const line = body
		.split('\n')
		.map((entry) => entry.replace(/^#{1,6}\s*/, '').trim())
		.find((entry) => entry.length > 0);

	return (line ?? '').slice(0, MAX_TITLE);
}

/** Newest first, which is the order both the sidebar and the tile's fallback
 *  want. */
export async function listNotes(target: TpDb = db): Promise<TpNote[]> {
	const notes = await target.notes.orderBy('updatedAt').reverse().toArray();
	// Pinned notes float, but the ordering *within* each group stays by recency
	// — a stable secondary sort, so a list does not reshuffle as you type.
	return [...notes].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
}

export async function createNote(body = '', target: TpDb = db): Promise<TpNote> {
	const note: TpNote = {
		id: newId('note'),
		title: titleOf(body),
		body,
		updatedAt: Date.now()
	};
	await target.notes.add(note);
	return note;
}

/** Writes a body, re-deriving the title and stamping the time. The debounced
 *  writer in `core/storage/dexie-writer.ts` is what calls this. */
export async function saveNote(id: string, body: string, target: TpDb = db): Promise<void> {
	await target.notes.update(id, {
		body,
		title: titleOf(body),
		updatedAt: Date.now()
	});
}

export async function deleteNote(id: string, target: TpDb = db): Promise<void> {
	await target.notes.delete(id);
}

export async function setPinned(id: string, pinned: boolean, target: TpDb = db): Promise<void> {
	await target.notes.update(id, { pinned });
}

/**
 * doc 07 §4: search matches title **and** body, as a substring.
 *
 * Folded on both sides, so `ghi chu` finds `Ghi chú` — typing a Vietnamese
 * search term with its diacritics to filter your own notes is a chore nobody
 * should have to do (`src/lib/i18n/fold.ts`).
 *
 * In memory rather than through Dexie: `notes` is indexed on `updatedAt`, not
 * on content, so a substring search is a full scan either way — and a personal
 * note collection is hundreds of rows, not millions.
 */
export function searchNotes(notes: readonly TpNote[], query: string): TpNote[] {
	const needle = foldForSearch(query.trim());
	if (needle === '') return [...notes];

	return notes.filter(
		(note) =>
			foldForSearch(note.title).includes(needle) || foldForSearch(note.body).includes(needle)
	);
}

/**
 * Which note the tile should show, given what its settings point at.
 *
 * doc 07 §4's edge case: "deleting the tile-pinned note → tile falls back to
 * most recent". The fallback is deliberately not written back into the tile's
 * settings — the user pinned *that* note, and silently re-pinning them to
 * another one would lose the fact that their choice is gone. The tile shows
 * the most recent instead, and pinning again is one click in the detail.
 */
export function resolveVisible(notes: readonly TpNote[], pinnedId: unknown): TpNote | null {
	if (typeof pinnedId === 'string') {
		const pinned = notes.find((note) => note.id === pinnedId);
		if (pinned !== undefined) return pinned;
	}
	return notes[0] ?? null;
}
