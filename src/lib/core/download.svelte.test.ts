import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob, downloadText } from './download';

/**
 * Browser project, because the contract is an anchor, a blob URL and a frame —
 * three things node does not have.
 */

afterEach(() => {
	vi.restoreAllMocks();
});

function watch() {
	const clicks: { href: string; download: string }[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
		this: HTMLAnchorElement
	) {
		clicks.push({ href: this.href, download: this.download });
	});
	const revoke = vi.spyOn(URL, 'revokeObjectURL');
	return { clicks, revoke };
}

describe('downloadBlob', () => {
	it('clicks an anchor that names the file and points at a blob URL', () => {
		const { clicks } = watch();

		downloadBlob('a.png', new Blob(['x'], { type: 'image/png' }));

		expect(clicks).toHaveLength(1);
		expect(clicks[0]?.download).toBe('a.png');
		expect(clicks[0]?.href).toMatch(/^blob:/);
	});

	it('revokes the URL on the next frame, not on the click', async () => {
		const { clicks, revoke } = watch();

		downloadBlob('a.txt', new Blob(['x']));

		// Same task as the click: still alive, so the download can start.
		expect(revoke).not.toHaveBeenCalled();
		await new Promise((resolve) => requestAnimationFrame(resolve));
		expect(revoke).toHaveBeenCalledWith(clicks[0]?.href);
	});
});

describe('downloadText', () => {
	it('wraps the text in a blob of the named type', async () => {
		const create = vi.spyOn(URL, 'createObjectURL');
		watch();

		downloadText('feeds.opml', '<opml/>', 'text/x-opml');

		const blob = create.mock.calls[0]?.[0] as Blob;
		expect(blob.type).toBe('text/x-opml');
		expect(await blob.text()).toBe('<opml/>');
	});
});
