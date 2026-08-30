/**
 * The seeded first-run deck (doc 13 §9), as a number the suite shares.
 *
 * That section seeds clock, weather, calendar, notes and quote, **filtered
 * through the registry** so it only contains widgets the build actually has —
 * which is why this number grew as widgets landed rather than being fixed at
 * five. It was 1 in Week 1, 2 in Week 2, 4 through Week 3, and is 5 now that
 * `weather` is registered — the full deck doc 13 §9 describes.
 *
 * Here rather than repeated as a literal in six files, because every one of
 * them broke on the same day for the same uninteresting reason.
 */
export const SEEDED_TILES = 5;

/**
 * Writes a layout **before the page ever loads**, and it has to be that way
 * round.
 *
 * The pattern these tests used to use — navigate, `localStorage.setItem`,
 * reload — has a race that only appeared once the seeded deck reached four
 * tiles. gridstack compacts a four-tile grid on mount and emits `change`, the
 * deck store schedules a debounced write (doc 04 §6), and the reload's
 * `pagehide` flushes it *over* whatever the test just wrote. The test then
 * reads back the seeded deck and fails somewhere unrelated.
 *
 * `addInitScript` runs before any of the page's own script, so there is no
 * window for anything to overwrite. Recorded in doc 19 §4.
 *
 * **It applies once**, guarded by a sessionStorage sentinel. An init script
 * stays registered for every later navigation, and a test that seeds a timer,
 * starts it and reloads would otherwise have the seed put back over what the
 * app just wrote — which is the opposite of what a reload is being used to
 * check.
 */
export async function seedLayout(page: import('@playwright/test').Page, grid: unknown[]) {
	await page.addInitScript(
		([key, value, sentinel]) => {
			if (sessionStorage.getItem(sentinel as string) !== null) return;
			sessionStorage.setItem(sentinel as string, '1');
			localStorage.setItem(key as string, value as string);
		},
		['tp.layout.v1', JSON.stringify({ schemaVersion: 1, grid }), 'tp.e2e.seeded'] as const
	);
}
