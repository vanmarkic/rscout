import type { SearchResult } from '../providers/types.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('bm25');

export interface BM25Options {
  k1?: number;      // Term frequency saturation parameter (default: 1.5)
  b?: number;       // Document length normalization (default: 0.75)
  delta?: number;   // BM25+ delta parameter (default: 0)
}

export interface BM25ScoredResult extends SearchResult {
  bm25Score: number;
}

/**
 * BM25 (Best Matching 25) ranking algorithm implementation.
 * Industry standard for information retrieval, better than TF-IDF for varied document lengths.
 *
 * Formula: score(D,Q) = Σ IDF(qi) * (f(qi,D) * (k1 + 1)) / (f(qi,D) + k1 * (1 - b + b * |D|/avgdl))
 */
export class BM25Ranker {
  private k1: number;
  private b: number;
  private delta: number;
  private idfCache = new Map<string, number>();
  private avgDocLength = 0;
  private totalDocs = 0;
  private docFrequency = new Map<string, number>();

  constructor(options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
    this.delta = options.delta ?? 0; // BM25+ adds delta to prevent negative IDF
  }

  /**
   * Build the index from a corpus of documents (search results)
   */
  buildIndex(results: SearchResult[]): void {
    this.totalDocs = results.length;
    this.docFrequency.clear();
    this.idfCache.clear();

    let totalLength = 0;

    for (const result of results) {
      const text = this.getDocumentText(result);
      const tokens = this.tokenize(text);
      const uniqueTokens = new Set(tokens);

      totalLength += tokens.length;

      // Count document frequency for each unique term
      for (const token of uniqueTokens) {
        this.docFrequency.set(token, (this.docFrequency.get(token) ?? 0) + 1);
      }
    }

    this.avgDocLength = totalLength / Math.max(this.totalDocs, 1);

    // Pre-compute IDF for all terms
    for (const [term, df] of this.docFrequency) {
      this.idfCache.set(term, this.computeIDF(df));
    }

    logger.debug({
      totalDocs: this.totalDocs,
      avgDocLength: this.avgDocLength,
      uniqueTerms: this.docFrequency.size,
    }, 'BM25 index built');
  }

  /**
   * Score all results against a query
   */
  scoreAll(results: SearchResult[], query: string): BM25ScoredResult[] {
    // Build index if not already built
    if (this.totalDocs === 0 || this.totalDocs !== results.length) {
      this.buildIndex(results);
    }

    const queryTokens = this.tokenize(query.toLowerCase());

    return results.map((result) => ({
      ...result,
      bm25Score: this.scoreDocument(result, queryTokens),
    })).sort((a, b) => b.bm25Score - a.bm25Score);
  }

  /**
   * Score a single document against query tokens
   */
  private scoreDocument(result: SearchResult, queryTokens: string[]): number {
    const text = this.getDocumentText(result);
    const docTokens = this.tokenize(text);
    const docLength = docTokens.length;

    // Count term frequencies in this document
    const termFrequency = new Map<string, number>();
    for (const token of docTokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }

    let score = 0;

    for (const queryTerm of queryTokens) {
      const tf = termFrequency.get(queryTerm) ?? 0;
      if (tf === 0) continue;

      const idf = this.idfCache.get(queryTerm) ?? this.computeIDF(0);

      // BM25 formula
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));

      score += idf * (numerator / denominator) + this.delta;
    }

    return score;
  }

  /**
   * Compute Inverse Document Frequency
   * IDF(qi) = ln((N - n(qi) + 0.5) / (n(qi) + 0.5) + 1)
   * Using the Robertson-Sparck Jones formula with smoothing
   */
  private computeIDF(docFreq: number): number {
    const n = this.totalDocs;
    const df = docFreq;

    // Standard BM25 IDF with smoothing to prevent negative values
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /**
   * Extract text content from a search result
   */
  private getDocumentText(result: SearchResult): string {
    // Weight title more heavily by repeating it
    return `${result.title} ${result.title} ${result.snippet}`.toLowerCase();
  }

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  /**
   * Get statistics about the index
   */
  getStats(): { totalDocs: number; avgDocLength: number; uniqueTerms: number } {
    return {
      totalDocs: this.totalDocs,
      avgDocLength: this.avgDocLength,
      uniqueTerms: this.docFrequency.size,
    };
  }
}

/**
 * Hybrid scorer combining BM25 with other signals
 */
export class HybridBM25Scorer {
  private bm25: BM25Ranker;

  constructor(
    private weights: {
      bm25: number;
      recency: number;
      domainAuthority: number;
    } = { bm25: 0.6, recency: 0.2, domainAuthority: 0.2 },
    private trustedDomains: string[] = []
  ) {
    this.bm25 = new BM25Ranker();
  }

  scoreAll(results: SearchResult[], query: string): Array<SearchResult & { score: number; bm25Score: number }> {
    // Get BM25 scores
    const bm25Results = this.bm25.scoreAll(results, query);

    // Normalize BM25 scores to 0-1 range
    const maxBm25 = Math.max(...bm25Results.map((r) => r.bm25Score), 1);

    return bm25Results.map((result) => {
      const normalizedBm25 = result.bm25Score / maxBm25;
      const recency = this.recencyScore(result.timestamp);
      const domain = this.domainScore(result.url);

      const finalScore =
        normalizedBm25 * this.weights.bm25 +
        recency * this.weights.recency +
        domain * this.weights.domainAuthority;

      return {
        ...result,
        score: Math.min(1, finalScore),
        bm25Score: result.bm25Score,
      };
    }).sort((a, b) => b.score - a.score);
  }

  private recencyScore(timestamp: Date): number {
    const daysSince = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0.1, 1 - daysSince / 365);
  }

  private domainScore(url: string): number {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      if (this.trustedDomains.some((d) => hostname.includes(d))) return 1.0;
      if (hostname.endsWith('.gov') || hostname.endsWith('.edu')) return 0.9;
      return 0.5;
    } catch {
      return 0.3;
    }
  }
}
