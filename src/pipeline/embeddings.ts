import type { SearchResult } from '../providers/types.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('embeddings');

// Lazy load transformers to avoid startup cost
let pipeline: typeof import('@xenova/transformers').pipeline | null = null;
let embeddingModel: Awaited<ReturnType<typeof import('@xenova/transformers').pipeline>> | null = null;

async function getEmbeddingModel() {
  if (embeddingModel) return embeddingModel;

  if (!pipeline) {
    const transformers = await import('@xenova/transformers');
    pipeline = transformers.pipeline;
  }

  logger.info('Loading embedding model (all-MiniLM-L6-v2)...');

  // all-MiniLM-L6-v2: 384-dimensional embeddings, ~23MB, runs on CPU
  // This is the same model Continue.dev uses for local embeddings
  embeddingModel = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    quantized: true, // Use quantized version for smaller size
  });

  logger.info('Embedding model loaded');
  return embeddingModel;
}

export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

export interface SemanticSearchResult extends SearchResult {
  similarity: number;
}

/**
 * Local embedding generator using all-MiniLM-L6-v2 via Transformers.js
 *
 * Model details:
 * - Size: ~23MB (quantized)
 * - Dimensions: 384
 * - Runs 100% locally on CPU
 * - No API calls, no cost
 * - Same model used by Continue.dev for privacy
 */
export class LocalEmbeddings {
  private cache = new Map<string, number[]>();

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    // Check cache
    const cacheKey = text.slice(0, 500); // Use first 500 chars as key
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const model = await getEmbeddingModel();

    // Generate embedding
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = await model(text, { pooling: 'mean', normalize: true } as any);

    // Extract embedding array - output is a Tensor with .data property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const embedding = Array.from((output as any).data as Float32Array);

    // Cache result
    this.cache.set(cacheKey, embedding);

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    // Process in batches to avoid memory issues
    const batchSize = 10;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const embeddings = await Promise.all(batch.map((text) => this.embed(text)));

      for (let j = 0; j < batch.length; j++) {
        results.push({
          text: batch[j] ?? '',
          embedding: embeddings[j] ?? [],
        });
      }

      logger.debug({ progress: Math.min(i + batchSize, texts.length), total: texts.length }, 'Embedding progress');
    }

    return results;
  }

  /**
   * Compute cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: number } {
    return {
      size: this.cache.size,
      keys: this.cache.size,
    };
  }
}

/**
 * Semantic search using local embeddings
 */
export class SemanticSearch {
  private embeddings: LocalEmbeddings;
  private documentEmbeddings = new Map<string, number[]>();

  constructor() {
    this.embeddings = new LocalEmbeddings();
  }

  /**
   * Index search results for semantic search
   */
  async indexResults(results: SearchResult[]): Promise<void> {
    logger.info({ count: results.length }, 'Indexing results for semantic search');

    for (const result of results) {
      const text = `${result.title} ${result.snippet}`;
      const embedding = await this.embeddings.embed(text);
      this.documentEmbeddings.set(result.url, embedding);
    }

    logger.info({ indexed: this.documentEmbeddings.size }, 'Indexing complete');
  }

  /**
   * Search results by semantic similarity to a query
   */
  async search(query: string, results: SearchResult[], topK = 10): Promise<SemanticSearchResult[]> {
    // Ensure results are indexed
    const unindexed = results.filter((r) => !this.documentEmbeddings.has(r.url));
    if (unindexed.length > 0) {
      await this.indexResults(unindexed);
    }

    // Get query embedding
    const queryEmbedding = await this.embeddings.embed(query);

    // Calculate similarities
    const scored: SemanticSearchResult[] = results.map((result) => {
      const docEmbedding = this.documentEmbeddings.get(result.url);
      const similarity = docEmbedding
        ? this.embeddings.cosineSimilarity(queryEmbedding, docEmbedding)
        : 0;

      return {
        ...result,
        similarity,
      };
    });

    // Sort by similarity and return top K
    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * Hybrid search combining keyword (BM25) and semantic similarity
   */
  async hybridSearch(
    query: string,
    results: SearchResult[],
    options: {
      topK?: number;
      keywordWeight?: number;
      semanticWeight?: number;
      keywordScores?: Map<string, number>;
    } = {}
  ): Promise<Array<SearchResult & { score: number; keywordScore: number; semanticScore: number }>> {
    const {
      topK = 10,
      keywordWeight = 0.5,
      semanticWeight = 0.5,
      keywordScores = new Map(),
    } = options;

    // Get semantic scores
    const semanticResults = await this.search(query, results, results.length);
    const semanticScoreMap = new Map(semanticResults.map((r) => [r.url, r.similarity]));

    // Normalize keyword scores if provided
    const maxKeyword = Math.max(...keywordScores.values(), 1);

    // Combine scores
    const combined = results.map((result) => {
      const keywordScore = (keywordScores.get(result.url) ?? 0) / maxKeyword;
      const semanticScore = semanticScoreMap.get(result.url) ?? 0;

      return {
        ...result,
        keywordScore,
        semanticScore,
        score: keywordWeight * keywordScore + semanticWeight * semanticScore,
      };
    });

    return combined
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Clear all indexed documents
   */
  clearIndex(): void {
    this.documentEmbeddings.clear();
    this.embeddings.clearCache();
  }
}

/**
 * Check if the embedding model is available (for health checks)
 */
export async function isEmbeddingModelAvailable(): Promise<boolean> {
  try {
    await getEmbeddingModel();
    return true;
  } catch {
    return false;
  }
}
