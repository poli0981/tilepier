import type { TpMediaFile } from './store.svelte';

/**
 * Asking the reader for a video, or for its subtitles (doc 09 §3), in the
 * click — both pickers need its activation.
 *
 * The File System Access picker where there is one (Chrome, Edge): a video's
 * handle lets the player read the file again, and a recent be reopened later
 * (Week 7 plan S6). An `<input>` everywhere else, Brave included, which ships
 * the API switched off.
 *
 * Both share the picker's `id`, so the browser opens the subtitles dialog in
 * the folder the video came from, which is where subtitles usually are.
 */

const PICKER_ID = 'tilepier-media';

interface TpPickFor {
	/** What the input offers. */
	accept: string;
	/** What the File System Access picker offers, under one named type. */
	types: Record<string, string[]>;
}

/** Anything labelled video, and .mkv, which many systems do not label at all. */
const VIDEOS: TpPickFor = {
	accept: 'video/*,.mkv',
	types: { 'video/*': ['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv'] }
};

const SUBTITLES: TpPickFor = {
	accept: '.srt,.vtt',
	types: { 'text/vtt': ['.vtt'], 'application/x-subrip': ['.srt'] }
};

interface TpPicked {
	file: File;
	handle?: FileSystemFileHandle | undefined;
}

/**
 * A file, or `null` when the reader cancelled. `label` names the file type in
 * the picker, which the reader sees — so it is a message, handed in by the
 * component, since `i18n:audit` does not read .ts files.
 */
async function pick(what: TpPickFor, label: string): Promise<TpPicked | null> {
	const picker = typeof window === 'undefined' ? undefined : window.showOpenFilePicker;
	if (picker !== undefined) {
		try {
			const [handle] = await picker.call(window, {
				id: PICKER_ID,
				multiple: false,
				types: [{ description: label, accept: what.types }]
			});
			if (handle === undefined) return null;
			return { file: await handle.getFile(), handle };
		} catch (error) {
			if ((error as { name?: unknown }).name === 'AbortError') return null;
			// Anything else (a picker a policy blocks, a file that went away
			// between choosing and reading) falls back to the input.
		}
	}
	const file = await pickWithInput(what.accept);
	return file === null ? null : { file };
}

export async function pickVideo(label: string): Promise<TpMediaFile | null> {
	const picked = await pick(VIDEOS, label);
	if (picked === null) return null;
	const { file, handle } = picked;
	return { name: file.name, size: file.size, file, handle };
}

export async function pickSubtitles(label: string): Promise<File | null> {
	return (await pick(SUBTITLES, label))?.file ?? null;
}

function pickWithInput(accept: string): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.click();
	});
}
