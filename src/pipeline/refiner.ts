import type { SearchResult } from '../providers/types.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('refiner');

export interface RefinementSuggestion {
  term: string;
  score: number;
  source: 'title' | 'snippet' | 'domain' | 'combined';
  frequency: number;
}

export interface RefinementOptions {
  maxSuggestions?: number;
  minTermLength?: number;
  excludeOriginalTerms?: boolean;
  includeNgrams?: boolean;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'the', 'this', 'but', 'they',
  'have', 'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'can', 'just', 'should', 'now', 'also', 'into', 'over', 'after',
  'before', 'between', 'under', 'again', 'then', 'once', 'here', 'there',
  'about', 'out', 'up', 'down', 'off', 'above', 'below', 'any', 'been',
  'being', 'could', 'did', 'does', 'doing', 'done', 'during', 'get', 'got',
  'getting', 'go', 'goes', 'going', 'gone', 'would', 'make', 'made', 'may',
  'might', 'much', 'must', 'need', 'our', 'ours', 'say', 'says', 'said',
  'see', 'seen', 'take', 'takes', 'took', 'their', 'them', 'these', 'those',
  'through', 'until', 'upon', 'us', 'use', 'used', 'using', 'want', 'wants',
  'way', 'ways', 'well', 'went', 'while', 'work', 'works', 'year', 'years',
  'you', 'your', 'yourself', 'http', 'https', 'www', 'com', 'org', 'net',
]);

export class QueryRefiner {
  private originalTerms: Set<string>;

  constructor(
    private originalQuery: string,
    private options: RefinementOptions = {}
  ) {
    this.originalTerms = new Set(
      this.tokenize(originalQuery).map(t => t.toLowerCase())
    );
  }

  extractSuggestions(results: SearchResult[]): RefinementSuggestion[] {
    const termFrequency = new Map<string, { count: number; sources: Set<string> }>();
    const bigramFrequency = new Map<string, { count: number; sources: Set<string> }>();

    for (const result of results) {
      // Extract from title (higher weight)
      this.processText(result.title, termFrequency, bigramFrequency, 'title', 2);

      // Extract from snippet
      this.processText(result.snippet, termFrequency, bigramFrequency, 'snippet', 1);

      // Extract domain keywords
      try {
        const domain = new URL(result.url).hostname.replace('www.', '');
        const domainParts = domain.split('.')[0]?.split('-') ?? [];
        for (const part of domainParts) {
          if (part.length >= 3 && !STOP_WORDS.has(part.toLowerCase())) {
            this.addTerm(termFrequency, part, 'domain', 0.5);
          }
        }
      } catch {
        // Ignore invalid URLs
      }
    }

    // Combine and score suggestions
    const suggestions: RefinementSuggestion[] = [];

    // Process single terms
    for (const [term, data] of termFrequency) {
      if (this.shouldIncludeTerm(term)) {
        const score = this.calculateScore(term, data.count, data.sources, results.length);
        suggestions.push({
          term,
          score,
          source: this.determinePrimarySource(data.sources),
          frequency: data.count,
        });
      }
    }

    // Process bigrams if enabled
    if (this.options.includeNgrams !== false) {
      for (const [bigram, data] of bigramFrequency) {
        if (data.count >= 2) { // Only include bigrams that appear multiple times
          const score = this.calculateScore(bigram, data.count, data.sources, results.length) * 1.2;
          suggestions.push({
            term: bigram,
            score,
            source: 'combined',
            frequency: data.count,
          });
        }
      }
    }

    // Sort by score and limit
    suggestions.sort((a, b) => b.score - a.score);
    const maxSuggestions = this.options.maxSuggestions ?? 10;

    logger.debug({
      totalTerms: termFrequency.size,
      totalBigrams: bigramFrequency.size,
      suggestions: suggestions.slice(0, maxSuggestions).map(s => s.term),
    }, 'Refinement suggestions extracted');

    return suggestions.slice(0, maxSuggestions);
  }

  buildRefinedQueries(
    selectedTerms: string[],
    strategy: 'expand' | 'narrow' | 'pivot' = 'expand'
  ): string[] {
    const queries: string[] = [];

    switch (strategy) {
      case 'expand':
        // Add terms to original query
        for (const term of selectedTerms) {
          queries.push(`${this.originalQuery} ${term}`);
        }
        // Also try combining top terms
        if (selectedTerms.length >= 2) {
          queries.push(`${this.originalQuery} ${selectedTerms.slice(0, 2).join(' ')}`);
        }
        break;

      case 'narrow':
        // Use original query with specific terms
        for (const term of selectedTerms) {
          queries.push(`"${this.originalQuery}" "${term}"`);
        }
        break;

      case 'pivot':
        // Replace original query with related terms
        for (const term of selectedTerms) {
          queries.push(term);
        }
        // Combine selected terms
        if (selectedTerms.length >= 2) {
          queries.push(selectedTerms.join(' '));
        }
        break;
    }

    return [...new Set(queries)]; // Deduplicate
  }

  private processText(
    text: string,
    termFreq: Map<string, { count: number; sources: Set<string> }>,
    bigramFreq: Map<string, { count: number; sources: Set<string> }>,
    source: string,
    weight: number
  ): void {
    const tokens = this.tokenize(text);

    // Process individual terms
    for (const token of tokens) {
      this.addTerm(termFreq, token, source, weight);
    }

    // Process bigrams
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      this.addTerm(bigramFreq, bigram, source, weight);
    }
  }

  private addTerm(
    freq: Map<string, { count: number; sources: Set<string> }>,
    term: string,
    source: string,
    weight: number
  ): void {
    const normalized = term.toLowerCase();
    const existing = freq.get(normalized);

    if (existing) {
      existing.count += weight;
      existing.sources.add(source);
    } else {
      freq.set(normalized, { count: weight, sources: new Set([source]) });
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= (this.options.minTermLength ?? 3));
  }

  private shouldIncludeTerm(term: string): boolean {
    const lowerTerm = term.toLowerCase();

    // Exclude stop words
    if (STOP_WORDS.has(lowerTerm)) return false;

    // Exclude original query terms if configured
    if (this.options.excludeOriginalTerms !== false && this.originalTerms.has(lowerTerm)) {
      return false;
    }

    // Exclude very short terms
    if (term.length < (this.options.minTermLength ?? 3)) return false;

    // Exclude pure numbers
    if (/^\d+$/.test(term)) return false;

    return true;
  }

  private calculateScore(
    term: string,
    frequency: number,
    sources: Set<string>,
    totalResults: number
  ): number {
    // Base score from frequency (normalized)
    const freqScore = Math.min(frequency / totalResults, 1);

    // Bonus for appearing in multiple sources
    const sourceBonus = (sources.size - 1) * 0.1;

    // Bonus for title appearances
    const titleBonus = sources.has('title') ? 0.2 : 0;

    // Length bonus (prefer medium-length terms)
    const idealLength = 8;
    const lengthScore = 1 - Math.abs(term.length - idealLength) / 20;

    return Math.min(1, freqScore + sourceBonus + titleBonus + lengthScore * 0.1);
  }

  private determinePrimarySource(sources: Set<string>): RefinementSuggestion['source'] {
    if (sources.has('title') && sources.has('snippet')) return 'combined';
    if (sources.has('title')) return 'title';
    if (sources.has('snippet')) return 'snippet';
    return 'domain';
  }
}

export function formatSuggestionsForDisplay(suggestions: RefinementSuggestion[]): string {
  if (suggestions.length === 0) {
    return 'No refinement suggestions found.';
  }

  const lines = ['', 'Suggested refinements:', ''];

  suggestions.forEach((s, i) => {
    const scoreBar = '█'.repeat(Math.round(s.score * 10)).padEnd(10, '░');
    lines.push(`  ${(i + 1).toString().padStart(2)}. ${s.term.padEnd(25)} ${scoreBar} (${s.source})`);
  });

  lines.push('');
  return lines.join('\n');
}
