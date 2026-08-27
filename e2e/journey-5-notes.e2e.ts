import { expect, test, type Page } from '@playwright/test';

/**
 * doc 19 §4 journey #5: "Notes: create, markdown preview renders, XSS string
 * stays inert."
 *
 * The XSS half is the reason this is a journey and not a unit test. The
 * sanitiser's own behaviour is covered exhaustively in
 * `src/lib/core/sanitize.svelte.test.ts`; what only a real page can show is
 * that the sanitised string is what actually reaches the DOM — that nothing
 * between `marked` and `{@html}` put the payload back.
 */

async function acceptGate(page: Page): Promise<void> {
	await page.goto('/');
	const accept = page.getByRole('button', { name: 'Tôi đồng ý' });
	await expect(accept).toBeEnabled();
	await accept.click();
	await expect(page.getByRole('main')).toBeVisible();
}

/** The notes tile from the seeded deck (doc 13 §9). */
function notesTile(page: Page) {
	return page
		.locator('.grid-stack-item', { has: page.getByTestId('notes-empty') })
		.or(page.locator('.grid-stack-item', { has: page.getByTestId('notes-preview') }));
}

test('the seeded deck offers an empty notes tile', async ({ page }) => {
	await acceptGate(page);

	// doc 06 §3's `empty`: guidance plus exactly one action.
	await expect(page.getByTestId('notes-empty')).toBeVisible();
	await expect(page.getByText('chưa có ghi chú')).toBeVisible();
});

test('a note can be written and its markdown renders', async ({ page }) => {
	await acceptGate(page);

	await page.getByRole('button', { name: 'tạo ghi chú đầu tiên' }).click();

	const editor = page.getByTestId('notes-editor');
	await expect(editor).toBeVisible();
	await editor.fill('# Shopping\n\n- **milk**\n- bread');

	// Blur commits and returns to the preview.
	await page.getByTestId('tp-grid').click({ position: { x: 5, y: 5 } });

	const preview = page.getByTestId('notes-preview');
	await expect(preview).toBeVisible();
	await expect(preview.locator('h1')).toHaveText('Shopping');
	await expect(preview.locator('strong')).toHaveText('milk');
	await expect(preview.locator('li')).toHaveCount(2);
});

test('a note survives a reload', async ({ page }) => {
	await acceptGate(page);
	await page.getByRole('button', { name: 'tạo ghi chú đầu tiên' }).click();
	await page.getByTestId('notes-editor').fill('remembered');
	await page.getByTestId('tp-grid').click({ position: { x: 5, y: 5 } });
	await expect(page.getByTestId('notes-preview')).toContainText('remembered');

	await page.reload();

	// Dexie, not localStorage — the note is user data (doc 05 §1).
	await expect(page.getByTestId('notes-preview')).toContainText('remembered');
});

test('an XSS payload in a note stays inert', async ({ page }) => {
	// Anything that executes fails the test loudly rather than silently.
	const fired: string[] = [];
	page.on('dialog', (dialog) => {
		fired.push(dialog.message());
		void dialog.dismiss();
	});
	page.on('pageerror', (error) => fired.push(String(error)));

	await acceptGate(page);
	await page.getByRole('button', { name: 'tạo ghi chú đầu tiên' }).click();

	await page
		.getByTestId('notes-editor')
		.fill(
			[
				'<script>alert("xss")</script>',
				'<img src=x onerror="alert(1)">',
				'<a href="javascript:alert(1)">click</a>',
				'<svg><script>alert(1)</script></svg>',
				'<iframe src="https://example.com"></iframe>',
				'plain text survives'
			].join('\n\n')
		);
	await page.getByTestId('tp-grid').click({ position: { x: 5, y: 5 } });

	const preview = page.getByTestId('notes-preview');
	await expect(preview).toContainText('plain text survives');

	// Nothing executable made it into the document.
	await expect(preview.locator('script')).toHaveCount(0);
	await expect(preview.locator('iframe')).toHaveCount(0);
	await expect(preview.locator('svg')).toHaveCount(0);
	await expect(preview.locator('[onerror]')).toHaveCount(0);
	await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);

	// And nothing ran.
	expect(fired).toEqual([]);
});

test('the detail lists, searches and deletes notes', async ({ page }) => {
	await acceptGate(page);
	await page.getByRole('button', { name: 'tạo ghi chú đầu tiên' }).click();
	await page.getByTestId('notes-editor').fill('Shopping list');
	await page.getByTestId('tp-grid').click({ position: { x: 5, y: 5 } });

	// Open the notes tile's detail. The clock is first on the deck, so this
	// picks the expand button belonging to the notes tile.
	await notesTile(page).getByRole('button', { name: 'mở chi tiết' }).click();
	await expect(page.getByTestId('detail-panel')).toBeVisible();

	await expect(page.getByTestId('notes-row')).toHaveCount(1);

	// A second note, then search narrows to one.
	await page.getByTestId('notes-new').click();
	await page.getByTestId('notes-detail-editor').fill('Ideas about boats');
	await expect(page.getByTestId('notes-row')).toHaveCount(2);

	await page.getByTestId('notes-search').fill('boats');
	await expect(page.getByTestId('notes-row')).toHaveCount(1);
	await page.getByTestId('notes-search').fill('');

	// doc 07 §4: delete is confirmed, in two steps rather than a blocking
	// confirm() dialog.
	await page.getByTestId('notes-delete').click();
	await page.getByTestId('notes-delete-confirm').click();
	await expect(page.getByTestId('notes-row')).toHaveCount(1);
});
