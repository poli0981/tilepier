import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('copyText', () => {
	it('writes the text and says so', async () => {
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		await expect(copyText('21.0285, 105.8542')).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith('21.0285, 105.8542');
	});

	it('turns a refusal into false rather than a rejection', async () => {
		vi.stubGlobal('navigator', {
			clipboard: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }
		});

		await expect(copyText('x')).resolves.toBe(false);
	});

	it('turns a missing clipboard into false — an insecure context has none', async () => {
		vi.stubGlobal('navigator', {});

		await expect(copyText('x')).resolves.toBe(false);
	});
});
