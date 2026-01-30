import type { SearchResult, ScoredResult } from '../providers/types.js';
import type { ScoringConfig } from '../config/schema.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('scorer');

export class Scorer {
  constructor(private config: ScoringConfig) {}

  score(result: SearchResult, query: string): ScoredResult {
    const recency = this.recencyScore(result.timestamp);
    const domain = this.domainScore(result.url);
    const relevance = this.relevanceScore(result, query);

    const totalScore =
      recency * this.config.weights.recency +
      domain * this.config.weights.domainAuthority +
      relevance * this.config.weights.keywordRelevance;

    return {
      ...result,
      score: totalScore,
    };
  }

  scoreAll(results: SearchResult[], query: string): ScoredResult[] {
    const scored = results.map((r) => this.score(r, query));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    logger.debug({ count: scored.length }, 'Scoring complete');
    return scored;
  }

  recencyScore(timestamp: Date): number {
    const now = Date.now();
    const age = now - timestamp.getTime();
    const daysSince = age / (1000 * 60 * 60 * 24);

    // Linear decay over 1 year, with floor at 0.1
    const score = Math.max(0.1, 1 - daysSince / 365);
    return score;
  }

  domainScore(url: string): number {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');

      // Check trusted domains
      for (const trusted of this.config.trustedDomains) {
        if (hostname === trusted || hostname.endsWith('.' + trusted)) {
          return 1.0;
        }
      }

      // Boost for educational and government domains
      if (hostname.endsWith('.gov') || hostname.endsWith('.edu')) {
        return 0.9;
      }

      // Boost for common high-quality domains
      const qualityDomains = [
        'nature.com',
        'science.org',
        'arxiv.org',
        'medium.com',
        'dev.to',
        'hackernews.com',
        'techcrunch.com',
        'wired.com',
        'arstechnica.com',
      ];

      for (const quality of qualityDomains) {
        if (hostname === quality || hostname.endsWith('.' + quality)) {
          return 0.8;
        }
      }

      // Default score
      return 0.5;
    } catch {
      return 0.3;
    }
  }

  relevanceScore(result: SearchResult, query: string): number {
    const queryTerms = this.tokenize(query);
    const titleTerms = this.tokenize(result.title);
    const snippetTerms = this.tokenize(result.snippet);

    if (queryTerms.length === 0) {
      return 0.5;
    }

    // Title matches are weighted higher
    let titleMatches = 0;
    let snippetMatches = 0;

    for (const term of queryTerms) {
      if (titleTerms.includes(term)) {
        titleMatches++;
      }
      if (snippetTerms.includes(term)) {
        snippetMatches++;
      }
    }

    // Calculate TF-IDF-lite score
    const titleScore = titleMatches / queryTerms.length;
    const snippetScore = snippetMatches / queryTerms.length;

    // Title matches are worth more
    const combinedScore = titleScore * 0.6 + snippetScore * 0.4;

    // Boost for exact phrase match in title
    if (result.title.toLowerCase().includes(query.toLowerCase())) {
      return Math.min(1.0, combinedScore + 0.2);
    }

    return combinedScore;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2);
  }
}
