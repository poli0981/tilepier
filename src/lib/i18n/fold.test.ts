import { describe, expect, it } from 'vitest';
import { foldForSearch } from './fold';

describe('foldForSearch', () => {
	it('strips Vietnamese tone and vowel marks', () => {
		expect(foldForSearch('Đồng hồ')).toBe('dong ho');
		expect(foldForSearch('Tiền tệ')).toBe('tien te');
		expect(foldForSearch('Lịch')).toBe('lich');
	});

	it('handles đ, which NFD leaves whole', () => {
		// It is a distinct letter, not d with a mark, so decomposition alone
		// would leave it and `dong` would never match `đồng`.
		expect(foldForSearch('Đ')).toBe('d');
		expect(foldForSearch('đá')).toBe('da');
	});

	it('leaves plain ASCII alone apart from case', () => {
		expect(foldForSearch('Clock')).toBe('clock');
		expect(foldForSearch('RSS feed')).toBe('rss feed');
	});

	it('is idempotent', () => {
		const once = foldForSearch('Đồng hồ');
		expect(foldForSearch(once)).toBe(once);
	});
});
