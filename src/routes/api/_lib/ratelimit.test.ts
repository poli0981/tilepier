import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT } from '#lib/shared-constants.js';
import { checkRateLimit, clientKey } from './ratelimit';

/**
 * The Worker's limiter (doc 11 §7, doc 15 §7): who a request counts against,
 * and what the binding's answer becomes. `hooks.server.test.ts` proves the
 * hook asks it first; the e2e in `e2e/rate-limit.e2e.ts` proves the binding
 * really counts, in workerd.
 */

const from = (address?: string) =>
	new Request('https://tilepier.win/api/weather', {
		headers: address === undefined ? {} : { 'cf-connecting-ip': address }
	});

/** A binding that allows `allowance` calls and records the keys it saw. */
function fakeLimiter(allowance = Number.POSITIVE_INFINITY) {
	const keys: string[] = [];
	const limiter: RateLimit = {
		limit: vi.fn(async ({ key }: RateLimitOptions) => {
			keys.push(key);
			return { success: keys.length <= allowance };
		})
	};
	return { limiter, keys };
}

describe('clientKey', () => {
	it('keys an IPv4 address as itself', () => {
		expect(clientKey(from('203.0.113.9'))).toBe('203.0.113.9');
	});

	it('keys an IPv6 address by its /64, however it is spelled', () => {
		// One subscriber holds the whole /64 and can rotate through it freely.
		const subnet = '2001:db8:1:2::/64';
		expect(clientKey(from('2001:db8:1:2::1'))).toBe(subnet);
		expect(clientKey(from('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd'))).toBe(subnet);
		expect(clientKey(from('2001:db8:1:2:ffff::'))).toBe(subnet);
		expect(clientKey(from('2001:db8::1'))).toBe('2001:db8:0:0::/64');
		expect(clientKey(from('2001:db8:1:3::1'))).not.toBe(subnet);
	});

	it('reads an IPv4-mapped IPv6 address as the IPv4 address it carries', () => {
		expect(clientKey(from('::ffff:203.0.113.9'))).toBe('203.0.113.9');
	});

	it('counts nobody when there is no address, rather than inventing one', () => {
		expect(clientKey(from())).toBeNull();
		expect(clientKey(from('  '))).toBeNull();
	});

	it('never trusts x-forwarded-for, which the client writes itself', () => {
		const spoofed = new Request('https://tilepier.win/api/weather', {
			headers: { 'x-forwarded-for': '198.51.100.4' }
		});
		expect(clientKey(spoofed)).toBeNull();
	});

	it("leaves loopback alone: that is wrangler dev's own address, never the edge's", () => {
		for (const loopback of [
			'127.0.0.1',
			'127.8.8.8',
			'::1',
			'0:0:0:0:0:0:0:1',
			'::ffff:127.0.0.1'
		]) {
			expect(clientKey(from(loopback)), loopback).toBeNull();
		}
		// Look-alikes are real addresses.
		expect(clientKey(from('::10'))).toBe('0:0:0:0::/64');
		expect(clientKey(from('128.0.0.1'))).toBe('128.0.0.1');
	});
});

describe('checkRateLimit', () => {
	it('allows up to what the binding allows, then names one whole period', async () => {
		const { limiter } = fakeLimiter(2);

		expect(await checkRateLimit(limiter, '203.0.113.9')).toEqual({ allowed: true, retryAfterS: 0 });
		expect((await checkRateLimit(limiter, '203.0.113.9')).allowed).toBe(true);
		expect(await checkRateLimit(limiter, '203.0.113.9')).toEqual({
			allowed: false,
			retryAfterS: RATE_LIMIT.bucketMs / 1000
		});
	});

	it('hands the binding a hash, never the address (doc 15 §7)', async () => {
		const { limiter, keys } = fakeLimiter();

		await checkRateLimit(limiter, '203.0.113.9');
		await checkRateLimit(limiter, '203.0.113.9');
		await checkRateLimit(limiter, '198.51.100.4');

		expect(keys[0]).toMatch(/^[0-9a-f]{32}$/);
		expect(keys[0]).not.toContain('203');
		// Stable, so one client is one counter, and distinct per client.
		expect(keys[1]).toBe(keys[0]);
		expect(keys[2]).not.toBe(keys[0]);
	});

	it('fails open when the binding is missing', async () => {
		expect((await checkRateLimit(undefined, '203.0.113.9')).allowed).toBe(true);
	});

	it('fails open when the binding throws', async () => {
		const limiter: RateLimit = { limit: vi.fn(() => Promise.reject(new Error('limiter down'))) };
		expect((await checkRateLimit(limiter, '203.0.113.9')).allowed).toBe(true);
	});
});
