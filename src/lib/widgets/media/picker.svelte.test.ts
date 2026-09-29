import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickSubtitles, pickVideo } from './picker';

/**
 * Asking for a video or its subtitles (doc 09 §3): the File System Access
 * picker where it exists, keeping a video's handle; the `<input>` where it
 * does not, or when it fails; and nothing at all when the reader cancels.
 */

const FILE = new File(['frames'], 'Phim thử.mp4', { type: 'video/mp4' });

function handle(file: File = FILE): FileSystemFileHandle {
	return { kind: 'file', name: file.name, getFile: async () => file } as FileSystemFileHandle;
}

/** The input's own dialog, answered: the file chosen, or a cancel. */
function answerInput(file: File | null): void {
	vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
		this: HTMLInputElement
	) {
		if (file === null) {
			this.dispatchEvent(new Event('cancel'));
			return;
		}
		const chosen = new DataTransfer();
		chosen.items.add(file);
		this.files = chosen.files;
		this.dispatchEvent(new Event('change'));
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Reflect.deleteProperty(window, 'showOpenFilePicker');
});

describe('pickVideo', () => {
	it('uses the File System Access picker where there is one, and keeps the handle', async () => {
		const picker = vi.fn(async (_options?: OpenFilePickerOptions) => [handle()]);
		window.showOpenFilePicker = picker;

		const picked = await pickVideo('Video');

		expect(picked?.name).toBe('Phim thử.mp4');
		expect(picked?.size).toBe(FILE.size);
		expect(picked?.handle).toBeDefined();
		const options = picker.mock.calls[0]?.[0];
		expect(options?.types?.[0]?.description).toBe('Video');
		expect(options?.types?.[0]?.accept['video/*']).toContain('.mkv');
	});

	it('is nothing when the reader closes the picker', async () => {
		window.showOpenFilePicker = async () => {
			throw new DOMException('closed', 'AbortError');
		};
		const click = vi.spyOn(HTMLInputElement.prototype, 'click');

		expect(await pickVideo('Video')).toBeNull();
		expect(click).not.toHaveBeenCalled();
	});

	it('falls back to the input when the picker fails otherwise, and then has no handle', async () => {
		window.showOpenFilePicker = async () => {
			throw new DOMException('blocked', 'SecurityError');
		};
		answerInput(FILE);

		const picked = await pickVideo('Video');

		expect(picked?.name).toBe('Phim thử.mp4');
		expect(picked?.handle).toBeUndefined();
	});

	it('uses the input where there is no picker, and is nothing on a cancel', async () => {
		answerInput(null);

		expect(await pickVideo('Video')).toBeNull();
	});
});

describe('pickSubtitles', () => {
	const SRT = new File(['1\n00:00:01,000 --> 00:00:02,000\nMột\n'], 'Phim thử.vi.srt');

	it('offers .srt and .vtt, in the folder the video came from', async () => {
		const picker = vi.fn(async (_options?: OpenFilePickerOptions) => [handle(SRT)]);
		window.showOpenFilePicker = picker;

		const picked = await pickSubtitles('Phụ đề');

		expect(picked?.name).toBe('Phim thử.vi.srt');
		const options = picker.mock.calls[0]?.[0];
		// The video picker's id: the browser remembers one folder for both.
		expect(options?.id).toBe('tilepier-media');
		expect(options?.types?.[0]?.description).toBe('Phụ đề');
		expect(options?.types?.[0]?.accept).toEqual({
			'text/vtt': ['.vtt'],
			'application/x-subrip': ['.srt']
		});
	});

	it('asks through the input for the same two where there is no picker', async () => {
		answerInput(SRT);
		let accept = '';
		const click = HTMLInputElement.prototype.click;
		vi.mocked(click).mockImplementationOnce(function (this: HTMLInputElement) {
			accept = this.accept;
			const chosen = new DataTransfer();
			chosen.items.add(SRT);
			this.files = chosen.files;
			this.dispatchEvent(new Event('change'));
		});

		expect((await pickSubtitles('Phụ đề'))?.name).toBe('Phim thử.vi.srt');
		expect(accept).toBe('.srt,.vtt');
	});
});
