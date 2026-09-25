/**
 * Puts text on the clipboard and says whether it got there (doc 03 §1: five
 * inline copies graduated in Week 6, ahead of the map's "copy coordinates").
 *
 * **It never throws.** The clipboard can be refused — a permission policy, an
 * insecure context where `navigator.clipboard` does not exist, a page without
 * focus — and three of the five copies awaited `writeText` with no `catch`, so
 * a refusal became an unhandled rejection from a button's click handler (the
 * toolbox tile and detail, and the quote tile). A copy is a convenience: the
 * text is on screen and selectable either way, so a refusal is `false` and the
 * caller simply shows no "copied".
 *
 * Nothing is logged, not even the failure: whatever was being copied may be a
 * bug report, a QR payload or a coordinate, and none of it belongs in the log
 * buffer that rides along with the next report.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
