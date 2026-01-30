import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Ranker, HybridBM25Scorer } from './bm25.js';
import type { SearchResult } from '../providers/types.js';

describe('BM25Ranker', () => {
  let ranker: BM25Ranker;

  const createResult = (title: string, snippet: string, url = 'https://example.com'): SearchResult => ({
    url,
    title,
    snippet,
    source: 'duckduckgo',
    timestamp: new Date(),
  });

  beforeEach(() => {
    ranker = new BM25Ranker();
  });

  describe('buildIndex', () => {
    it('builds index from search results', () => {
      const results = [
        createResult('TypeScript Tutorial', 'Learn TypeScript programming'),
        createResult('JavaScript Guide', 'Introduction to JavaScript'),
      ];

      ranker.buildIndex(results);
      const stats = ranker.getStats();

      expect(stats.totalDocs).toBe(2);
      expect(stats.avgDocLength).toBeGreaterThan(0);
      expect(stats.uniqueTerms).toBeGreaterThan(0);
    });
  });

  describe('scoreAll', () => {
    it('scores results based on query relevance', () => {
      const results = [
        createResult('TypeScript Tutorial', 'Learn TypeScript programming', 'https://ts.com'),
        createResult('JavaScript Guide', 'Introduction to JavaScript', 'https://js.com'),
        createResult('Python Basics', 'Getting started with Python', 'https://py.com'),
      ];

      const scored = ranker.scoreAll(results, 'typescript');

      // TypeScript result should rank highest
      expect(scored[0]?.url).toBe('https://ts.com');
      expect(scored[0]?.bm25Score).toBeGreaterThan(scored[1]?.bm25Score ?? 0);
    });

    it('handles multi-word queries', () => {
      const results = [
        createResult('TypeScript Design Patterns', 'Common patterns in TypeScript'),
        createResult('JavaScript Functions', 'How to write functions'),
      ];

      const scored = ranker.scoreAll(results, 'typescript patterns');

      expect(scored[0]?.title).toContain('TypeScript');
      expect(scored[0]?.bm25Score).toBeGreaterThan(0);
    });

    it('returns zero score for non-matching documents', () => {
      const results = [
        createResult('Python Machine Learning', 'Deep learning with Python'),
      ];

      const scored = ranker.scoreAll(results, 'typescript');

      expect(scored[0]?.bm25Score).toBe(0);
    });

    it('handles empty results', () => {
      const scored = ranker.scoreAll([], 'typescript');
      expect(scored).toHaveLength(0);
    });
  });

  describe('BM25 algorithm properties', () => {
    it('term frequency saturation - repeated terms have diminishing returns', () => {
      const results = [
        createResult('TypeScript', 'TypeScript TypeScript TypeScript TypeScript'),
        createResult('TypeScript Guide', 'Learn TypeScript programming basics'),
      ];

      const scored = ranker.scoreAll(results, 'typescript');

      // The heavily repeated version shouldn't score dramatically higher
      // due to term frequency saturation (k1 parameter)
      const ratio = (scored[0]?.bm25Score ?? 0) / (scored[1]?.bm25Score ?? 1);
      expect(ratio).toBeLessThan(3); // Should be relatively close
    });

    it('longer documents are normalized', () => {
      const shortDoc = createResult('TS', 'TypeScript', 'https://short.com');
      const longDoc = createResult(
        'TypeScript Comprehensive Guide',
        'TypeScript is a programming language that builds on JavaScript. ' +
        'TypeScript adds optional static typing and class-based object-oriented programming. ' +
        'Many developers use TypeScript for large applications.',
        'https://long.com'
      );

      const scored = ranker.scoreAll([shortDoc, longDoc], 'typescript');

      // Both should have scores, document length normalization applies
      expect(scored.every((r) => r.bm25Score > 0)).toBe(true);
    });
  });
});

describe('HybridBM25Scorer', () => {
  const createResult = (
    title: string,
    snippet: string,
    url: string,
    timestamp: Date
  ): SearchResult => ({
    url,
    title,
    snippet,
    source: 'duckduckgo',
    timestamp,
  });

  it('combines BM25 with recency and domain authority', () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); // 1 year ago

    const results = [
      createResult('TypeScript', 'Learn TS', 'https://github.com/ts', now),
      createResult('TypeScript', 'Learn TS', 'https://random.com/ts', oldDate),
    ];

    const scorer = new HybridBM25Scorer(
      { bm25: 0.5, recency: 0.3, domainAuthority: 0.2 },
      ['github.com']
    );

    const scored = scorer.scoreAll(results, 'typescript');

    // GitHub + recent should rank higher
    expect(scored[0]?.url).toBe('https://github.com/ts');
  });

  it('respects weight configuration', () => {
    const results = [
      createResult('TypeScript', 'Learn', 'https://example.com', new Date()),
    ];

    const heavyBM25 = new HybridBM25Scorer({ bm25: 0.9, recency: 0.05, domainAuthority: 0.05 });
    const heavyRecency = new HybridBM25Scorer({ bm25: 0.1, recency: 0.8, domainAuthority: 0.1 });

    const bm25Scored = heavyBM25.scoreAll(results, 'typescript');
    const recencyScored = heavyRecency.scoreAll(results, 'typescript');

    // Both should produce valid scores
    expect(bm25Scored[0]?.score).toBeGreaterThan(0);
    expect(recencyScored[0]?.score).toBeGreaterThan(0);
  });
});
