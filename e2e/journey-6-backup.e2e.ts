import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * doc 19 §4 journey #6: "Export backup → wipe → import → deck + notes
 * restored."
 *
 * The point of doing this end to end rather than in a unit test is the parts
 * a unit test cannot reach: that the browser is actually handed a file, that
 * the file it is handed parses, and that a restore puts the deck and the notes
 * back where a person would look for them.
 */

async function acceptGate(page: Page): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
}

/** Writes a note through the seeded notes tile, so there is user data worth
 *  round-tripping — which is the reason doc 23 moved this journey to Week 2. */
async function writeNote(page: Page, text: string): Promise<void> {
	await page.getByRole('button', { name: 'tạo ghi chú đầu tiên' }).click();
	await page.getByTestId('notes-editor').fill(text);
	await page.getByTestId('tp-grid').click({ position: { x: 5, y: 5 } });
	await expect(page.getByTestId('notes-preview')).toContainText(text);
}

/**
 * Waits for the deck to reach `count` tiles **in storage**, not just on screen.
 *
 * doc 04 §6 debounces the layout write 500 ms after gridstack settles, and an
 * export reads the store — so leaving for /settings the instant a tile appears
 * exports the deck as it was a moment before. journey #2 waits the same way,
 * for the same reason.
 */
async function awaitStoredTiles(page: Page, count: number): Promise<void> {
	await expect
		.poll(() =>
			page.evaluate(() => {
				const raw = localStorage.getItem('tp.layout.v1');
				return raw === null ? 0 : (JSON.parse(raw) as { grid: unknown[] }).grid.length;
			})
		)
		.toBe(count);
}

async function exportBackup(page: Page): Promise<string> {
	await page.goto('/settings');
	const download = page.waitForEvent('download');
	await page.getByTestId('backup-export').click();

	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^tilepier-backup-\d{8}\.json$/);

	const path = await file.path();
	return readFile(path, 'utf8');
}

/**
 * Erases everything the way the Storage section does, and comes back through
 * the gate — a wiped device is a new one, and `tp.legal.v1` went with the rest
 * (doc 16 §3.6). Ends on the deck, which is where every caller wants to be.
 */
async function wipe(page: Page): Promise<void> {
	await page.goto('/settings');
	await page.getByTestId('erase-data').click();
	await page.getByTestId('erase-confirm').click();

	// The erase reloads whatever page it was on — /settings, which has no
	// `<main>` — so the gate is asserted here and the deck is reached below.
	await expect(page.getByRole('button', { name: 'Tôi đồng ý' })).toBeEnabled();

	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
}

/** Puts a backup's text into the file input without a real file picker. */
async function importBackup(page: Page, json: string): Promise<void> {
	await page.getByTestId('backup-file').setInputFiles({
		name: 'tilepier-backup-20260827.json',
		mimeType: 'application/json',
		buffer: Buffer.from(json, 'utf8')
	});
	await expect(page.getByTestId('backup-review')).toBeVisible();
}

test('a backup round-trips the deck and the notes', async ({ page }) => {
	await acceptGate(page);
	await writeNote(page, 'survives the wipe');

	// A third tile, so the restored deck is distinguishable from the seed.
	await page.getByTestId('open-drawer').click();
	await page.getByTestId('add-clock').click();
	await expect(page.locator('.grid-stack-item')).toHaveCount(3);
	await page.getByTestId('drawer-scrim').click({ position: { x: 4, y: 4 } });
	await awaitStoredTiles(page, 3);

	const json = await exportBackup(page);
	expect(json).toContain('survives the wipe');

	await wipe(page);
	await expect(page.getByTestId('notes-empty')).toBeVisible();

	await page.goto('/settings');
	await importBackup(page, json);
	await page.getByTestId('backup-replace').click();
	await page.getByTestId('backup-replace-confirm').click();

	// The restore is asynchronous — it reads IndexedDB, writes it back, then
	// writes the layout and reloads. Navigating on the click alone races it, and
	// the page would be torn down before the layout was restored. Waiting for
	// the layout key to hold the restored deck is the signal that it finished.
	await awaitStoredTiles(page, 3);

	await page.goto('/');
	await expect(page.locator('.grid-stack-item')).toHaveCount(3);
	await expect(page.getByTestId('notes-preview')).toContainText('survives the wipe');
});

test('the dry run reports what it would do, before doing it', async ({ page }) => {
	await acceptGate(page);
	await writeNote(page, 'counted');

	const json = await exportBackup(page);
	await wipe(page);

	await page.goto('/settings');
	await importBackup(page, json);

	// doc 05 §6: counts per table, and nothing written until the user confirms.
	await expect(page.getByTestId('backup-review')).toContainText('ghi chú');
	await page.getByTestId('backup-cancel').click();
	await expect(page.getByTestId('backup-review')).toBeHidden();

	await page.goto('/');
	await expect(page.getByTestId('notes-empty')).toBeVisible();
});

test('merge adds what is missing and removes nothing', async ({ page }) => {
	await acceptGate(page);
	await writeNote(page, 'from the backup');

	const json = await exportBackup(page);

	// A second note that the backup has never seen.
	await page.goto('/');
	await page.getByTestId('notes-preview').click();
	await page.getByTestId('notes-editor').fill('written afterwards');
	await page.getByTestId('tp-grid').click({ position: { x: 5, y: 5 } });

	// Waiting for the preview to show it is what proves the write landed: the
	// tile re-reads from Dexie after a flush, so the text can only appear here
	// if the debounced write actually completed. Navigating before that would
	// race the write, and the merge would then be comparing the wrong copy.
	await expect(page.getByTestId('notes-preview')).toContainText('written afterwards');

	await page.goto('/settings');
	await importBackup(page, json);
	await page.getByTestId('backup-merge').click();
	await expect(page.getByTestId('backup-done')).toBeVisible();

	// doc 05 §6's non-destructive default: the newer local edit stands.
	await page.goto('/');
	await expect(page.getByTestId('notes-preview')).toContainText('written afterwards');
});

test('replace saves a backup of the current state first', async ({ page }) => {
	// doc 05 §6's forced-backup pattern. A destructive restore that turns out to
	// have been the wrong file is the one case where this earns its interruption.
	await acceptGate(page);
	await writeNote(page, 'about to be replaced');

	const json = await exportBackup(page);
	await page.goto('/settings');
	await importBackup(page, json);

	const safety = page.waitForEvent('download');
	await page.getByTestId('backup-replace').click();
	await page.getByTestId('backup-replace-confirm').click();

	const file = await safety;
	const saved = await readFile(await file.path(), 'utf8');
	expect(saved).toContain('about to be replaced');
});

test('a file that is not a backup is refused, and nothing changes', async ({ page }) => {
	await acceptGate(page);
	await writeNote(page, 'still here');

	await page.goto('/settings');
	await page.getByTestId('backup-file').setInputFiles({
		name: 'not-a-backup.json',
		mimeType: 'application/json',
		buffer: Buffer.from('{"hello":"world"}', 'utf8')
	});

	await expect(page.getByTestId('backup-invalid')).toBeVisible();
	await expect(page.getByTestId('backup-review')).toBeHidden();

	await page.goto('/');
	await expect(page.getByTestId('notes-preview')).toContainText('still here');
});
