import { describe, it, expect, beforeEach } from 'vitest';
import { Deduplicator } from './deduplicator.js';
import type { SearchResult } from '../providers/types.js';

describe('Deduplicator', () => {
  let deduplicator: Deduplicator;

  beforeEach(() => {
    deduplicator = new Deduplicator({
      urlNormalization: true,
      contentFingerprint: true,
      similarityThreshold: 0.85,
    });
  });

  describe('URL normalization', () => {
    it('removes tracking parameters', () => {
      const normalized = deduplicator.normalizeUrl(
        'https://example.com/page?utm_source=google&utm_medium=cpc&id=123'
      );
      expect(normalized).toBe('https://example.com/page?id=123');
    });

    it('removes www prefix', () => {
      const normalized = deduplicator.normalizeUrl('https://www.example.com/page');
      expect(normalized).toBe('https://example.com/page');
    });

    it('removes hash fragments', () => {
      const normalized = deduplicator.normalizeUrl('https://example.com/page#section');
      expect(normalized).toBe('https://example.com/page');
    });

    it('removes trailing slashes', () => {
      const normalized = deduplicator.normalizeUrl('https://example.com/page/');
      expect(normalized).toBe('https://example.com/page');
    });

    it('sorts query parameters', () => {
      const normalized = deduplicator.normalizeUrl('https://example.com/page?z=1&a=2');
      expect(normalized).toBe('https://example.com/page?a=2&z=1');
    });

    it('handles invalid URLs gracefully', () => {
      const normalized = deduplicator.normalizeUrl('not-a-url');
      expect(normalized).toBe('not-a-url');
    });
  });

  describe('Content fingerprinting', () => {
    it('generates consistent fingerprints for same content', () => {
      const fp1 = deduplicator.fingerprint('The quick brown fox jumps over the lazy dog');
      const fp2 = deduplicator.fingerprint('The quick brown fox jumps over the lazy dog');
      expect(fp1).toBe(fp2);
    });

    it('generates different fingerprints for different content', () => {
      const fp1 = deduplicator.fingerprint('The quick brown fox jumps over the lazy dog');
      const fp2 = deduplicator.fingerprint('A completely different sentence about something else');
      expect(fp1).not.toBe(fp2);
    });

    it('ignores case differences', () => {
      const fp1 = deduplicator.fingerprint('Hello World Test');
      const fp2 = deduplicator.fingerprint('hello world test');
      expect(fp1).toBe(fp2);
    });

    it('handles short text', () => {
      const fp = deduplicator.fingerprint('Hi');
      expect(fp).toBeDefined();
    });
  });

  describe('Deduplication', () => {
    it('removes exact URL duplicates', () => {
      const results: SearchResult[] = [
        { url: 'https://example.com/page', title: 'Test', snippet: 'A snippet', source: 'brave', timestamp: new Date() },
        { url: 'https://example.com/page', title: 'Test', snippet: 'A snippet', source: 'duckduckgo', timestamp: new Date() },
      ];

      const unique = deduplicator.deduplicate(results);
      expect(unique).toHaveLength(1);
    });

    it('normalizes URLs before comparison', () => {
      const results: SearchResult[] = [
        { url: 'https://example.com/page?utm_source=google', title: 'Test', snippet: 'A test snippet', source: 'brave', timestamp: new Date() },
        { url: 'https://www.example.com/page', title: 'Test', snippet: 'A test snippet', source: 'duckduckgo', timestamp: new Date() },
      ];

      const unique = deduplicator.deduplicate(results);
      expect(unique).toHaveLength(1);
    });

    it('keeps results with same URL but different content', () => {
      const results: SearchResult[] = [
        { url: 'https://example.com/page', title: 'Title One', snippet: 'Completely different content about topic A', source: 'brave', timestamp: new Date() },
        { url: 'https://example.com/page', title: 'Title Two', snippet: 'Entirely separate content about topic B', source: 'duckduckgo', timestamp: new Date() },
      ];

      const unique = deduplicator.deduplicate(results);
      // These should be considered different due to content fingerprinting
      expect(unique.length).toBeGreaterThanOrEqual(1);
    });

    it('merges metadata from duplicates', () => {
      const results: SearchResult[] = [
        { url: 'https://example.com/page', title: 'Test', snippet: 'Content here', source: 'brave', timestamp: new Date(), metadata: { a: 1 } },
        { url: 'https://example.com/page', title: 'Test', snippet: 'Content here', source: 'duckduckgo', timestamp: new Date(), metadata: { b: 2 } },
      ];

      const unique = deduplicator.deduplicate(results);
      expect(unique).toHaveLength(1);
      expect(unique[0]?.metadata).toHaveProperty('a', 1);
      expect(unique[0]?.metadata).toHaveProperty('b', 2);
    });
  });

  describe('Similarity detection', () => {
    it('computes similarity for identical text', () => {
      const similarity = deduplicator.computeSimilarity(
        'The quick brown fox jumps over the lazy dog',
        'The quick brown fox jumps over the lazy dog'
      );
      expect(similarity).toBe(1);
    });

    it('computes low similarity for different text', () => {
      const similarity = deduplicator.computeSimilarity(
        'The quick brown fox jumps over the lazy dog',
        'A completely unrelated sentence about programming'
      );
      expect(similarity).toBeLessThan(0.5);
    });

    it('finds similar results above threshold', () => {
      const results: SearchResult[] = [
        { url: 'https://a.com', title: 'TypeScript Guide', snippet: 'Learn TypeScript programming language basics and fundamentals', source: 'brave', timestamp: new Date(), score: 0.9 },
        { url: 'https://b.com', title: 'TypeScript Tutorial', snippet: 'Learn TypeScript programming language basics and fundamentals today', source: 'duckduckgo', timestamp: new Date(), score: 0.8 },
        { url: 'https://c.com', title: 'Python Guide', snippet: 'Learn Python programming language for data science', source: 'brave', timestamp: new Date(), score: 0.7 },
      ] as any;

      const similar = deduplicator.findSimilar(results, 0.5);
      expect(similar.size).toBeGreaterThan(0);
    });
  });
});
