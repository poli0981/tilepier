import { describe, expect, it } from 'vitest';
import { byCodeUnit } from './order';

describe('byCodeUnit', () => {
	it('orders by UTF-16 code unit, as a sort with no comparator does', () => {
		const words = ['vnd', 'USD', 'Asia/Saigon', 'asia', 'Đà Lạt', 'BTC-USD', '10', '9', '', 'a'];

		expect(words.sort(byCodeUnit)).toEqual([
			'',
			'10',
			'9',
			'Asia/Saigon',
			'BTC-USD',
			'USD',
			'a',
			'asia',
			'vnd',
			'Đà Lạt'
		]);
	});

	it('calls equal strings equal, whatever the locale', () => {
		expect(byCodeUnit('USD', 'USD')).toBe(0);
		expect(byCodeUnit('EUR', 'USD')).toBeLessThan(0);
		expect(byCodeUnit('USD', 'EUR')).toBeGreaterThan(0);
		// localeCompare would put these the other way round in most locales.
		expect(byCodeUnit('B', 'a')).toBeLessThan(0);
	});
});
