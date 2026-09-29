import type { TpMediaFile } from './store.svelte';

/**
 * Asking the reader for a video (doc 09 §3), in the click — both pickers need
 * its activation.
 *
 * The File System Access picker where there is one (Chrome, Edge): its handle
 * lets the player read the file again, and a recent be reopened later (Week 7
 * plan S6). An `<input>` everywhere else, Brave included, which ships the API
 * switched off.
 */

/** What the input offers: anything labelled video, and .mkv, which many
 *  systems do not label at all. */
const ACCEPT = 'video/*,.mkv';

/** What the File System Access picker offers under its one file type. */
const EXTENSIONS = ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv'];

/**
 * A video, or `null` when the reader cancelled. `label` names the file type in
 * the picker, which the reader sees — so it is a message, handed in by the
 * component, since `i18n:audit` does not read .ts files.
 */
export async function pickVideo(label: string): Promise<TpMediaFile | null> {
	const picker = typeof window === 'undefined' ? undefined : window.showOpenFilePicker;
	if (picker !== undefined) {
		try {
			const [handle] = await picker.call(window, {
				id: 'tilepier-media',
				multiple: false,
				types: [{ description: label, accept: { 'video/*': EXTENSIONS } }]
			});
			if (handle === undefined) return null;
			const file = await handle.getFile();
			return { name: file.name, size: file.size, file, handle };
		} catch (error) {
			if ((error as { name?: unknown }).name === 'AbortError') return null;
			// Anything else (a picker a policy blocks, a file that went away
			// between choosing and reading) falls back to the input.
		}
	}
	return pickWithInput();
}

function pickWithInput(): Promise<TpMediaFile | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = ACCEPT;
		input.addEventListener(
			'change',
			() => {
				const file = input.files?.[0];
				resolve(file === undefined ? null : { name: file.name, size: file.size, file });
			},
			{ once: true }
		);
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.click();
	});
}
