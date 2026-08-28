import { afterEach, describe, expect, it } from 'vitest';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { dateKeyOf } from '$lib/core/date-key';
import { HISTORY_DAYS, focusHistory, logFocusSession } from './service';

/**
 * The Dexie half of doc 07 §2's history strip.
 *
 * Browser project — the `.svelte.` infix is what selects it (doc 19 §1) — for
 * the same reason `db.svelte.test.ts` is: real IndexedDB, so this exercises
 * Dexie rather than a stub of it. Everything that does not touch storage is in
 * `service.test.ts`, which stays in node and stays fast.
 */

const MINUTE = 60_000;
const created: TpDb[] = [];

function freshDb(): TpDb {
	const db = createDb(`tilepier-timer-${crypto.randomUUID()}`);
	created.push(db);
	return db;
}

/** Local midday on a given day offset from today — far from either midnight,
 *  so the assertions do not depend on when the suite happens to run. */
function daysAgo(days: number): number {
	const at = new Date();
	at.setHours(12, 0, 0, 0);
	at.setDate(at.getDate() - days);
	return at.getTime();
}

afterEach(async () => {
	while (created.length > 0) {
		const db = created.pop();
		await db?.delete();
	}
});

describe('focusHistory', () => {
	it('returns one entry per day, oldest first, even with nothing logged', () => {
		// A sparkline with gaps in it lies about its own x-axis.
		return focusHistory(Date.now(), HISTORY_DAYS, freshDb()).then((days) => {
			expect(days).toHaveLength(HISTORY_DAYS);
			expect(days.every((day) => day.focusMs === 0)).toBe(true);
			expect(days[days.length - 1]?.dateKey).toBe(dateKeyOf(Date.now()));
			expect([...days].map((d) => d.dateKey)).toEqual([...days].map((d) => d.dateKey).sort());
		});
	});

	it('totals several sessions on the same day', async () => {
		const db = freshDb();
		const today = dateKeyOf(Date.now());

		await logFocusSession({ dateKey: today, focusMs: 25 * MINUTE }, db);
		await logFocusSession({ dateKey: today, focusMs: 25 * MINUTE }, db);

		const days = await focusHistory(Date.now(), HISTORY_DAYS, db);
		expect(days[days.length - 1]).toEqual({ dateKey: today, focusMs: 50 * MINUTE });
	});

	it('places a session on its own day', async () => {
		const db = freshDb();
		await logFocusSession({ dateKey: dateKeyOf(daysAgo(3)), focusMs: 25 * MINUTE }, db);

		const days = await focusHistory(Date.now(), HISTORY_DAYS, db);
		const found = days.filter((day) => day.focusMs > 0);

		expect(found).toHaveLength(1);
		expect(found[0]?.dateKey).toBe(dateKeyOf(daysAgo(3)));
	});

	it('ignores sessions older than the window', async () => {
		const db = freshDb();
		await logFocusSession({ dateKey: dateKeyOf(daysAgo(HISTORY_DAYS + 5)), focusMs: MINUTE }, db);
		await logFocusSession({ dateKey: dateKeyOf(Date.now()), focusMs: MINUTE }, db);

		const days = await focusHistory(Date.now(), HISTORY_DAYS, db);
		expect(days.filter((day) => day.focusMs > 0)).toHaveLength(1);
	});

	it('gives every session its own row', async () => {
		// Ids come from newId('fs'); two sessions logged in the same millisecond
		// must not collide and silently become one.
		const db = freshDb();
		const today = dateKeyOf(Date.now());

		await Promise.all([
			logFocusSession({ dateKey: today, focusMs: MINUTE }, db),
			logFocusSession({ dateKey: today, focusMs: MINUTE }, db),
			logFocusSession({ dateKey: today, focusMs: MINUTE }, db)
		]);

		expect(await db.focusSessions.count()).toBe(3);
	});

	it('takes a shorter window when asked', async () => {
		const db = freshDb();
		const days = await focusHistory(Date.now(), 7, db);
		expect(days).toHaveLength(7);
	});
});
