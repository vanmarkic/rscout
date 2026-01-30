import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DuckDuckGoProvider } from './duckduckgo.js';
import { RateLimiter } from '../utils/rate-limiter.js';

describe('DuckDuckGoProvider', () => {
  let provider: DuckDuckGoProvider;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter('duckduckgo', 10);
    provider = new DuckDuckGoProvider(rateLimiter);
  });

  describe('Provider interface', () => {
    it('has correct name', () => {
      expect(provider.name).toBe('duckduckgo');
    });
  });

  describe('Search (mocked)', () => {
    it('normalizes results correctly', async () => {
      const mockResponse = {
        Abstract: 'TypeScript is a programming language',
        AbstractText: 'TypeScript is a strongly typed programming language that builds on JavaScript',
        AbstractSource: 'Wikipedia',
        AbstractURL: 'https://en.wikipedia.org/wiki/TypeScript',
        Heading: 'TypeScript',
        Image: 'https://example.com/ts-logo.png',
        RelatedTopics: [
          {
            Text: 'JavaScript - A scripting language',
            FirstURL: 'https://en.wikipedia.org/wiki/JavaScript',
            Result: '<a href="https://en.wikipedia.org/wiki/JavaScript">JavaScript</a> - A scripting language',
          },
        ],
        Results: [],
        Type: 'A',
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const results = await provider.search('typescript', { limit: 10 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({
        url: 'https://en.wikipedia.org/wiki/TypeScript',
        title: 'TypeScript',
        source: 'duckduckgo',
      });
      expect(results[0]?.snippet).toContain('TypeScript');
    });

    it('handles empty response gracefully', async () => {
      const mockResponse = {
        Abstract: '',
        AbstractText: '',
        AbstractSource: '',
        AbstractURL: '',
        Heading: '',
        Image: '',
        RelatedTopics: [],
        Results: [],
        Type: '',
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const results = await provider.search('xyznonexistent', { limit: 10 });
      expect(results).toHaveLength(0);
    });

    it('throws ProviderError on HTTP error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(provider.search('test', { limit: 10 })).rejects.toThrow('HTTP 500');
    });

    it('respects limit option', async () => {
      const mockResponse = {
        Abstract: '',
        AbstractText: '',
        AbstractSource: '',
        AbstractURL: '',
        Heading: '',
        Image: '',
        RelatedTopics: Array(20).fill({
          Text: 'Topic',
          FirstURL: 'https://example.com/topic',
          Result: '<a href="https://example.com/topic">Topic</a>',
        }),
        Results: [],
        Type: 'D',
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const results = await provider.search('test', { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Health check', () => {
    it('returns true on successful response', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
      } as Response);

      const healthy = await provider.healthCheck();
      expect(healthy).toBe(true);
    });

    it('returns false on error', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const healthy = await provider.healthCheck();
      expect(healthy).toBe(false);
    });
  });
});
