import { describe, it, expect, beforeEach } from 'vitest';
import { QueryRefiner, formatSuggestionsForDisplay } from './refiner.js';
import type { SearchResult } from '../providers/types.js';

describe('QueryRefiner', () => {
  const createResult = (title: string, snippet: string, url = 'https://example.com'): SearchResult => ({
    url,
    title,
    snippet,
    source: 'duckduckgo',
    timestamp: new Date(),
  });

  describe('extractSuggestions', () => {
    it('extracts terms from titles and snippets', () => {
      const refiner = new QueryRefiner('typescript');
      const results = [
        createResult('TypeScript Tutorial for Beginners', 'Learn TypeScript programming basics'),
        createResult('Advanced TypeScript Patterns', 'Design patterns and best practices'),
      ];

      const suggestions = refiner.extractSuggestions(results);

      expect(suggestions.length).toBeGreaterThan(0);
      const terms = suggestions.map(s => s.term);
      expect(terms).toContain('tutorial');
      expect(terms).toContain('patterns');
    });

    it('excludes original query terms by default', () => {
      const refiner = new QueryRefiner('typescript tutorial');
      const results = [
        createResult('TypeScript Tutorial Guide', 'Complete TypeScript tutorial for developers'),
      ];

      const suggestions = refiner.extractSuggestions(results);
      const terms = suggestions.map(s => s.term);

      expect(terms).not.toContain('typescript');
      expect(terms).not.toContain('tutorial');
    });

    it('excludes stop words', () => {
      const refiner = new QueryRefiner('test');
      const results = [
        createResult('The Best Guide to Testing', 'This is a comprehensive guide and it has everything'),
      ];

      const suggestions = refiner.extractSuggestions(results);
      const terms = suggestions.map(s => s.term);

      expect(terms).not.toContain('the');
      expect(terms).not.toContain('and');
      expect(terms).not.toContain('this');
    });

    it('respects maxSuggestions option', () => {
      const refiner = new QueryRefiner('test', { maxSuggestions: 3 });
      const results = [
        createResult('Word1 Word2 Word3 Word4 Word5', 'More words here for testing purposes'),
      ];

      const suggestions = refiner.extractSuggestions(results);

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });

    it('includes bigrams when enabled', () => {
      const refiner = new QueryRefiner('typescript', { includeNgrams: true });
      const results = [
        createResult('Design Patterns in TypeScript', 'Learn design patterns'),
        createResult('TypeScript Design Patterns', 'Explore design patterns'),
      ];

      const suggestions = refiner.extractSuggestions(results);
      const terms = suggestions.map(s => s.term);

      expect(terms.some(t => t.includes(' '))).toBe(true);
    });

    it('extracts domain keywords', () => {
      const refiner = new QueryRefiner('programming');
      const results = [
        createResult('Test', 'Test', 'https://developer-guide.com/page'),
      ];

      const suggestions = refiner.extractSuggestions(results);
      const terms = suggestions.map(s => s.term);

      expect(terms).toContain('developer');
    });

    it('scores terms appearing in titles higher', () => {
      const refiner = new QueryRefiner('test');
      const results = [
        createResult('Important Framework Guide', 'Some snippet content'),
        createResult('Other Title', 'framework mentioned here'),
      ];

      const suggestions = refiner.extractSuggestions(results);
      const frameworkSuggestion = suggestions.find(s => s.term === 'framework');

      expect(frameworkSuggestion).toBeDefined();
      expect(frameworkSuggestion?.source).toBe('combined');
    });
  });

  describe('buildRefinedQueries', () => {
    let refiner: QueryRefiner;

    beforeEach(() => {
      refiner = new QueryRefiner('typescript');
    });

    it('builds expand queries by adding terms', () => {
      const queries = refiner.buildRefinedQueries(['react', 'node'], 'expand');

      expect(queries).toContain('typescript react');
      expect(queries).toContain('typescript node');
      expect(queries).toContain('typescript react node');
    });

    it('builds narrow queries with quotes', () => {
      const queries = refiner.buildRefinedQueries(['patterns'], 'narrow');

      expect(queries.some(q => q.includes('"typescript"'))).toBe(true);
      expect(queries.some(q => q.includes('"patterns"'))).toBe(true);
    });

    it('builds pivot queries replacing original', () => {
      const queries = refiner.buildRefinedQueries(['react', 'vue'], 'pivot');

      expect(queries).toContain('react');
      expect(queries).toContain('vue');
      expect(queries).toContain('react vue');
    });

    it('deduplicates queries', () => {
      const queries = refiner.buildRefinedQueries(['same', 'same'], 'expand');
      const uniqueQueries = [...new Set(queries)];

      expect(queries.length).toBe(uniqueQueries.length);
    });
  });

  describe('formatSuggestionsForDisplay', () => {
    it('returns message for empty suggestions', () => {
      const output = formatSuggestionsForDisplay([]);

      expect(output).toContain('No refinement suggestions');
    });

    it('formats suggestions with score bars', () => {
      const suggestions = [
        { term: 'framework', score: 0.8, source: 'title' as const, frequency: 5 },
        { term: 'patterns', score: 0.5, source: 'snippet' as const, frequency: 3 },
      ];

      const output = formatSuggestionsForDisplay(suggestions);

      expect(output).toContain('framework');
      expect(output).toContain('patterns');
      expect(output).toContain('█');
      expect(output).toContain('title');
      expect(output).toContain('snippet');
    });

    it('numbers suggestions', () => {
      const suggestions = [
        { term: 'first', score: 0.9, source: 'title' as const, frequency: 5 },
        { term: 'second', score: 0.8, source: 'title' as const, frequency: 4 },
      ];

      const output = formatSuggestionsForDisplay(suggestions);

      expect(output).toContain('1.');
      expect(output).toContain('2.');
    });
  });
});
