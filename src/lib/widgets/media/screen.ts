/**
 * Picture-in-picture and full screen for the video player (doc 09 §3), each
 * behind a feature check (Week 7 plan S16):
 *
 * - **Picture-in-picture** where `document.pictureInPictureEnabled` says so —
 *   Chrome, Edge, Safari, Firefox desktop from 153 — and only for a video with
 *   a picture. Firefox on Android and webviews have none, and the button is
 *   not drawn. It ends with the detail (owner decision Q2), which this module
 *   does itself rather than trusting the browser to (`leaveScreens`).
 * - **Full screen** on the player's box, so the controls come along. An
 *   iPhone has no element full screen: there the video's own
 *   `webkitEnterFullscreen` hands it to Safari's player until the reader
 *   leaves.
 *
 * Both need the reader's gesture (doc 22 §S8), so they are called from a click
 * or a key, and a refusal is not an error worth telling anyone about.
 */

type TpWebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export function canPip(video: HTMLVideoElement | null): boolean {
	return (
		video !== null &&
		document.pictureInPictureEnabled &&
		!video.disablePictureInPicture &&
		video.videoWidth > 0
	);
}

export async function togglePip(video: HTMLVideoElement): Promise<void> {
	try {
		if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
		else await video.requestPictureInPicture();
	} catch {
		// Refused: no gesture, or a policy. The button stays as it was.
	}
}

export function canFullscreen(video: HTMLVideoElement | null): boolean {
	return (
		document.fullscreenEnabled ||
		typeof (video as TpWebkitVideo | null)?.webkitEnterFullscreen === 'function'
	);
}

export async function toggleFullscreen(box: HTMLElement, video: HTMLVideoElement): Promise<void> {
	try {
		if (document.fullscreenElement === box) await document.exitFullscreen();
		else if (document.fullscreenEnabled) await box.requestFullscreen();
		else (video as TpWebkitVideo).webkitEnterFullscreen?.();
	} catch {
		// Refused, as above.
	}
}

/** Both left as the player goes: picture-in-picture ends with the detail. */
export function leaveScreens(box: HTMLElement | null, video: HTMLVideoElement): void {
	if (document.pictureInPictureElement === video) {
		void document.exitPictureInPicture().catch(() => undefined);
	}
	if (box !== null && document.fullscreenElement === box) {
		void document.exitFullscreen().catch(() => undefined);
	}
}
