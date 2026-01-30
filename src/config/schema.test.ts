import { describe, it, expect } from 'vitest';
import { ConfigSchema } from './schema.js';

describe('ConfigSchema', () => {
  describe('Default values', () => {
    it('provides sensible defaults for empty config', () => {
      const result = ConfigSchema.parse({});

      expect(result.providers.duckduckgo.enabled).toBe(true);
      expect(result.providers.brave.enabled).toBe(false);
      expect(result.search.defaultLimit).toBe(20);
      expect(result.search.timeout).toBe(10000);
      expect(result.output.format).toBe('markdown');
    });

    it('provides default scoring weights', () => {
      const result = ConfigSchema.parse({});

      expect(result.scoring.weights.recency).toBe(0.3);
      expect(result.scoring.weights.domainAuthority).toBe(0.2);
      expect(result.scoring.weights.keywordRelevance).toBe(0.5);
    });

    it('provides default trusted domains', () => {
      const result = ConfigSchema.parse({});

      expect(result.scoring.trustedDomains).toContain('wikipedia.org');
      expect(result.scoring.trustedDomains).toContain('github.com');
    });
  });

  describe('Validation', () => {
    it('rejects negative rate limits', () => {
      const result = ConfigSchema.safeParse({
        providers: {
          duckduckgo: {
            rateLimit: -1,
          },
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid output format', () => {
      const result = ConfigSchema.safeParse({
        output: {
          format: 'xml',
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects negative timeout', () => {
      const result = ConfigSchema.safeParse({
        search: {
          timeout: -100,
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects similarity threshold out of range', () => {
      const resultHigh = ConfigSchema.safeParse({
        deduplication: {
          similarityThreshold: 1.5,
        },
      });

      const resultLow = ConfigSchema.safeParse({
        deduplication: {
          similarityThreshold: -0.1,
        },
      });

      expect(resultHigh.success).toBe(false);
      expect(resultLow.success).toBe(false);
    });

    it('accepts valid RSS feed URLs', () => {
      const result = ConfigSchema.safeParse({
        providers: {
          rss: {
            feeds: [
              'https://example.com/feed.xml',
              'https://blog.example.com/rss',
            ],
          },
        },
      });

      expect(result.success).toBe(true);
    });

    it('rejects invalid RSS feed URLs', () => {
      const result = ConfigSchema.safeParse({
        providers: {
          rss: {
            feeds: ['not-a-url'],
          },
        },
      });

      expect(result.success).toBe(false);
    });
  });

  describe('Merging', () => {
    it('merges partial config with defaults', () => {
      const result = ConfigSchema.parse({
        search: {
          defaultLimit: 50,
        },
        output: {
          obsidian: {
            tags: ['custom-tag'],
          },
        },
      });

      expect(result.search.defaultLimit).toBe(50);
      expect(result.search.timeout).toBe(10000); // default
      expect(result.output.obsidian.tags).toContain('custom-tag');
      expect(result.output.obsidian.frontmatter).toBe(true); // default
    });
  });
});
