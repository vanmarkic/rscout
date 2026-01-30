import { describe, it, expect, beforeEach } from 'vitest';
import { Scorer } from './scorer.js';
import type { SearchResult } from '../providers/types.js';

describe('Scorer', () => {
  let scorer: Scorer;

  beforeEach(() => {
    scorer = new Scorer({
      weights: {
        recency: 0.3,
        domainAuthority: 0.2,
        keywordRelevance: 0.5,
      },
      trustedDomains: [
        'wikipedia.org',
        'github.com',
        'developer.mozilla.org',
      ],
    });
  });

  describe('Recency scoring', () => {
    it('gives high score to recent content', () => {
      const now = new Date();
      const score = scorer.recencyScore(now);
      expect(score).toBeCloseTo(1, 1);
    });

    it('gives lower score to older content', () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const score = scorer.recencyScore(sixMonthsAgo);
      expect(score).toBeLessThan(0.6);
      expect(score).toBeGreaterThan(0.4);
    });

    it('gives minimum score to very old content', () => {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const score = scorer.recencyScore(twoYearsAgo);
      expect(score).toBe(0.1); // Floor value
    });
  });

  describe('Domain scoring', () => {
    it('gives maximum score to trusted domains', () => {
      expect(scorer.domainScore('https://github.com/repo')).toBe(1.0);
      expect(scorer.domainScore('https://en.wikipedia.org/wiki/Test')).toBe(1.0);
      expect(scorer.domainScore('https://developer.mozilla.org/docs')).toBe(1.0);
    });

    it('gives high score to .edu and .gov domains', () => {
      expect(scorer.domainScore('https://stanford.edu/research')).toBe(0.9);
      expect(scorer.domainScore('https://nasa.gov/missions')).toBe(0.9);
    });

    it('gives default score to unknown domains', () => {
      expect(scorer.domainScore('https://randomsite.com/page')).toBe(0.5);
    });

    it('handles invalid URLs gracefully', () => {
      expect(scorer.domainScore('not-a-url')).toBe(0.3);
    });
  });

  describe('Relevance scoring', () => {
    it('gives high score when all query terms match', () => {
      const result: SearchResult = {
        url: 'https://example.com',
        title: 'TypeScript Tutorial for Beginners',
        snippet: 'Learn TypeScript programming from scratch',
        source: 'brave',
        timestamp: new Date(),
      };

      const score = scorer.relevanceScore(result, 'typescript tutorial');
      expect(score).toBeGreaterThan(0.8);
    });

    it('gives bonus for exact phrase match in title', () => {
      const result: SearchResult = {
        url: 'https://example.com',
        title: 'TypeScript tutorial',
        snippet: 'Learn TypeScript tutorial basics',
        source: 'brave',
        timestamp: new Date(),
      };

      const score = scorer.relevanceScore(result, 'TypeScript tutorial');
      // Title: 2/2 match = 1.0, Snippet: 2/2 match = 1.0
      // Combined: 1.0 * 0.6 + 1.0 * 0.4 = 1.0, plus 0.2 bonus capped at 1.0
      expect(score).toBe(1.0);
    });

    it('gives zero score when no terms match', () => {
      const result: SearchResult = {
        url: 'https://example.com',
        title: 'Python Programming',
        snippet: 'Learn Python basics',
        source: 'brave',
        timestamp: new Date(),
      };

      const score = scorer.relevanceScore(result, 'javascript react');
      expect(score).toBe(0);
    });

    it('weights title matches higher than snippet matches', () => {
      const titleMatch: SearchResult = {
        url: 'https://example.com',
        title: 'TypeScript Guide',
        snippet: 'Some unrelated content',
        source: 'brave',
        timestamp: new Date(),
      };

      const snippetMatch: SearchResult = {
        url: 'https://example.com',
        title: 'Programming Guide',
        snippet: 'This covers TypeScript',
        source: 'brave',
        timestamp: new Date(),
      };

      const titleScore = scorer.relevanceScore(titleMatch, 'typescript');
      const snippetScore = scorer.relevanceScore(snippetMatch, 'typescript');

      expect(titleScore).toBeGreaterThan(snippetScore);
    });
  });

  describe('Overall scoring', () => {
    it('combines all scores with configured weights', () => {
      const result: SearchResult = {
        url: 'https://github.com/typescript/handbook',
        title: 'TypeScript Handbook',
        snippet: 'Official TypeScript documentation',
        source: 'brave',
        timestamp: new Date(),
      };

      const scored = scorer.score(result, 'typescript handbook');

      expect(scored.score).toBeGreaterThan(0.8);
      expect(scored.url).toBe(result.url);
      expect(scored.title).toBe(result.title);
    });

    it('sorts results by score descending', () => {
      const results: SearchResult[] = [
        {
          url: 'https://randomsite.com/page',
          title: 'Some Page',
          snippet: 'Unrelated content',
          source: 'brave',
          timestamp: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        },
        {
          url: 'https://github.com/typescript',
          title: 'TypeScript GitHub',
          snippet: 'TypeScript repository',
          source: 'duckduckgo',
          timestamp: new Date(),
        },
      ];

      const scored = scorer.scoreAll(results, 'typescript');

      expect(scored[0]?.url).toBe('https://github.com/typescript');
      expect(scored[0]?.score).toBeGreaterThan(scored[1]?.score ?? 0);
    });
  });
});
