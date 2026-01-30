import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Token bucket', () => {
    it('allows immediate acquisition when tokens available', async () => {
      const limiter = new RateLimiter('test', 2); // 2 requests per second

      const start = Date.now();
      await limiter.acquire();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });

    it('reports correct available tokens', () => {
      const limiter = new RateLimiter('test', 2);

      expect(limiter.getAvailableTokens()).toBe(2);

      limiter.tryAcquire();
      expect(limiter.getAvailableTokens()).toBe(1);

      limiter.tryAcquire();
      expect(limiter.getAvailableTokens()).toBe(0);
    });

    it('tryAcquire returns false when no tokens available', () => {
      const limiter = new RateLimiter('test', 1);

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });

    it('refills tokens over time', async () => {
      const limiter = new RateLimiter('test', 2);

      limiter.tryAcquire();
      limiter.tryAcquire();
      expect(limiter.getAvailableTokens()).toBe(0);

      // Advance time by 1 second
      vi.advanceTimersByTime(1000);

      expect(limiter.getAvailableTokens()).toBe(2);
    });

    it('does not exceed max tokens', async () => {
      const limiter = new RateLimiter('test', 2);

      // Advance time significantly
      vi.advanceTimersByTime(10000);

      expect(limiter.getAvailableTokens()).toBe(2); // Max is 2
    });
  });

  describe('Rate limiting behavior', () => {
    it('waits when no tokens available', async () => {
      const limiter = new RateLimiter('test', 1);

      // Use the one available token
      await limiter.acquire();

      // Start acquiring another (should wait)
      const acquirePromise = limiter.acquire();

      // Advance time to allow refill
      vi.advanceTimersByTime(1000);

      await acquirePromise;
      // Should complete without error
    });

    it('handles fractional rates', () => {
      const limiter = new RateLimiter('test', 0.5); // 1 request per 2 seconds

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);

      // After 1 second, should have 0.5 tokens (not enough)
      vi.advanceTimersByTime(1000);
      expect(limiter.tryAcquire()).toBe(false);

      // After another second, should have 1 token
      vi.advanceTimersByTime(1000);
      expect(limiter.tryAcquire()).toBe(true);
    });
  });
});
