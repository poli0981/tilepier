/**
 * A video's still (doc 09 §3's poster frame): the frame the reader stopped on,
 * small, for the tile, the recents and the lock screen.
 *
 * - Drawn when the video pauses and when the player goes — not when it ends,
 *   whose last frame is often black, and not mid-seek.
 * - At most 320 px wide, as a JPEG of at most 50 KB: quality 0.7, then 0.55,
 *   then 0.4, and no still at all if none fits. A still that big is a picture
 *   with detail in it, and a tile shows it at a tenth of that.
 * - **Drawing is synchronous**, so the teardown can draw before the element
 *   lets go of the file; encoding and the write come after. A `<video>` the
 *   page no longer holds still draws, and a `blob:` source never taints the
 *   canvas (doc 22 §S8).
 */

const POSTER_WIDTH = 320;
export const POSTER_MAX_BYTES = 50 * 1024;
const QUALITIES = [0.7, 0.55, 0.4] as const;

/** The frame showing now, or `null` when there is none worth drawing. */
export function drawPoster(video: HTMLVideoElement): HTMLCanvasElement | null {
	if (
		video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
		video.videoWidth === 0 ||
		video.seeking
	) {
		return null;
	}
	const width = Math.min(POSTER_WIDTH, video.videoWidth);
	const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (context === null) return null;
	try {
		context.drawImage(video, 0, 0, width, height);
	} catch {
		return null;
	}
	return canvas;
}

/** The drawing as a JPEG within {@link POSTER_MAX_BYTES}, or `null`. */
export async function encodePoster(canvas: HTMLCanvasElement): Promise<Blob | null> {
	for (const quality of QUALITIES) {
		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, 'image/jpeg', quality);
		});
		if (blob !== null && blob.size <= POSTER_MAX_BYTES) return blob;
	}
	return null;
}
