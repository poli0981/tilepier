import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { resetPlayback } from '$lib/core/playback';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { media } from './store.svelte';
import TpMediaDetail from './TpMediaDetail.svelte';
import TpMediaWidget from './TpMediaWidget.svelte';

/**
 * The video tile and the detail around the player (doc 09 §3): one click from
 * an empty tile opens a file and the detail; a tile with a video open shows
 * how far in it is; the detail with nothing open offers the one way in.
 */

const DEFAULT: TpTileSize = { w: 4, h: 3, pxW: 420, pxH: 216, tier: 'L' };
const SMALL: TpTileSize = { w: 2, h: 2, pxW: 200, pxH: 140, tier: 'M' };
const FILE = new File(['frames'], 'Phim thử.mp4', { type: 'video/mp4' });

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	media.reset();
});

afterEach(() => {
	cleanup();
	media.reset();
	resetPlayback();
	settings.dispose();
	vi.restoreAllMocks();
	Reflect.deleteProperty(window, 'showOpenFilePicker');
});

function tile(size: TpTileSize, onOpenDetail = vi.fn()) {
	return {
		onOpenDetail,
		screen: render(TpMediaWidget, {
			props: { instanceId: 'wgt_media', settings: {}, size, onOpenDetail }
		})
	};
}

describe('TpMediaWidget', () => {
	it('offers to open a video, and says it stays on the device where there is room', async () => {
		const { screen } = tile(DEFAULT);

		await expect.element(screen.getByTestId('media-empty')).toBeVisible();
		await expect.element(screen.getByText(m['widget.media.local_note']())).toBeVisible();
	});

	it('keeps to one button on the smallest tile', async () => {
		const { screen } = tile(SMALL);

		await expect.element(screen.getByTestId('media-tile-open')).toBeVisible();
		expect(screen.container.textContent).not.toContain(m['widget.media.local_note']());
	});

	it('opens a video and its detail in one click', async () => {
		window.showOpenFilePicker = async () => [
			{ kind: 'file', name: FILE.name, getFile: async () => FILE } as FileSystemFileHandle
		];
		const { screen, onOpenDetail } = tile(DEFAULT);

		await screen.getByTestId('media-tile-open').click();

		await vi.waitFor(() => expect(onOpenDetail).toHaveBeenCalledOnce());
		expect(media.current?.name).toBe('Phim thử.mp4');
	});

	it('stays as it was when the reader closes the picker', async () => {
		window.showOpenFilePicker = async () => {
			throw new DOMException('closed', 'AbortError');
		};
		const { screen, onOpenDetail } = tile(DEFAULT);

		await screen.getByTestId('media-tile-open').click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(onOpenDetail).not.toHaveBeenCalled();
		expect(media.current).toBeNull();
	});

	it('shows the open video, how far in it is, and the way back to it', async () => {
		media.open({ name: FILE.name, size: FILE.size, file: FILE });
		media.report(65_000, 187_000, true);
		const { screen, onOpenDetail } = tile(DEFAULT);

		await expect.element(screen.getByText('Phim thử.mp4')).toBeVisible();
		await expect.element(screen.getByText('1:05 / 3:07')).toBeVisible();
		await screen.getByTestId('media-continue').click();

		expect(onOpenDetail).toHaveBeenCalledOnce();
	});
});

describe('TpMediaDetail', () => {
	function detail() {
		return render(TpMediaDetail, {
			props: { instanceId: 'wgt_media', settings: {}, close: () => {} }
		});
	}

	it('with nothing open, offers the one way in', async () => {
		const screen = detail();

		await expect.element(screen.getByTestId('media-nothing')).toBeVisible();
		await expect.element(screen.getByTestId('media-open')).toBeVisible();
	});

	it('plays the open video, under its name, with a way to open another', async () => {
		media.open({ name: FILE.name, size: FILE.size, file: FILE });
		const screen = detail();

		await expect.element(screen.getByTestId('media-player')).toBeInTheDocument();
		await expect.element(screen.getByText('Phim thử.mp4')).toBeVisible();
		await expect.element(screen.getByTestId('media-open-another')).toBeVisible();
	});
});
