import { describe, expect, it } from 'vitest';
import { haversineKm } from './geo-distance';

describe('haversineKm', () => {
	it('measures the distances everyone knows', () => {
		// London to Paris, centre to centre: about 343.5 km.
		expect(haversineKm({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 })).toBeCloseTo(
			343.5,
			0
		);
		// Hoàn Kiếm to Bến Thành: about 1 137 km.
		const km = haversineKm({ lat: 21.0285, lon: 105.8542 }, { lat: 10.7725, lon: 106.698 });
		expect(km).toBeGreaterThan(1130);
		expect(km).toBeLessThan(1145);
	});

	it('is zero from a place to itself, and the same both ways', () => {
		const a = { lat: 21.0285, lon: 105.8542 };
		const b = { lat: 20.5417, lon: 105.9229 };
		expect(haversineKm(a, a)).toBe(0);
		expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
	});

	it('does not go NaN at the antipode, where rounding can push past 1', () => {
		expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(20015.1, 0);
	});
});
