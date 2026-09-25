/**
 * Hands the browser a file (doc 03 §1: the third copy of this graduated).
 *
 * It lived inline in three places — the backup export, the QR code's PNG and
 * the bug report — and the copies had already drifted: the bug report revoked
 * its object URL on the same tick as the click, the other two a frame later.
 * The OPML export of Week 6 would have been the fourth.
 *
 * **A blob URL rather than a `data:` URL.** A data URL is a string the browser
 * has to hold entire — megabytes of base64 for a version-40 QR code at scale 12,
 * or for a backup with a year of notes in it — and Safari caps its length.
 *
 * **Revoked on the next frame**, which is after the click has been dispatched
 * and before the URL can outlive its purpose. Not on the same tick: the click
 * starts the download, and revoking inside the same task is a race some engines
 * lose.
 */
export function downloadBlob(name: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/** Text of a known type, which is every caller but the canvas one. */
export function downloadText(name: string, text: string, type: string): void {
	downloadBlob(name, new Blob([text], { type }));
}
