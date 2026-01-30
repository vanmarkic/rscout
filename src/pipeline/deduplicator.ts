import type { SearchResult } from '../providers/types.js';
import type { DeduplicationConfig } from '../config/schema.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('deduplicator');

export class Deduplicator {
  private seen = new Map<string, SearchResult>();

  constructor(private config: DeduplicationConfig) {}

  deduplicate(results: SearchResult[]): SearchResult[] {
    this.seen.clear();
    const unique: SearchResult[] = [];
    let duplicates = 0;

    for (const result of results) {
      const key = this.generateKey(result);

      if (!this.seen.has(key)) {
        this.seen.set(key, result);
        unique.push(result);
      } else {
        duplicates++;
        // Merge metadata from duplicate
        const existing = this.seen.get(key)!;
        existing.metadata = { ...existing.metadata, ...result.metadata };

        // Keep the result from the first provider, but note we saw it in multiple
        if (!existing.metadata?.['sources']) {
          existing.metadata = existing.metadata ?? {};
          existing.metadata['sources'] = [existing.source];
        }
        if (Array.isArray(existing.metadata['sources'])) {
          (existing.metadata['sources'] as string[]).push(result.source);
        }
      }
    }

    logger.debug({ original: results.length, unique: unique.length, duplicates }, 'Deduplication complete');
    return unique;
  }

  private generateKey(result: SearchResult): string {
    const parts: string[] = [];

    if (this.config.urlNormalization) {
      parts.push(this.normalizeUrl(result.url));
    } else {
      parts.push(result.url);
    }

    if (this.config.contentFingerprint) {
      parts.push(this.fingerprint(result.title + ' ' + result.snippet));
    }

    return parts.join(':');
  }

  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Remove hash
      parsed.hash = '';

      // Remove common tracking parameters
      const trackingParams = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'fbclid',
        'gclid',
        'ref',
        'source',
        'mc_eid',
        'mc_cid',
      ];

      for (const param of trackingParams) {
        parsed.searchParams.delete(param);
      }

      // Sort remaining params for consistent comparison
      parsed.searchParams.sort();

      // Normalize hostname (remove www, lowercase)
      let hostname = parsed.hostname.toLowerCase();
      if (hostname.startsWith('www.')) {
        hostname = hostname.slice(4);
      }

      // Normalize path (remove trailing slash)
      let pathname = parsed.pathname;
      if (pathname.length > 1 && pathname.endsWith('/')) {
        pathname = pathname.slice(0, -1);
      }

      // Reconstruct normalized URL
      const search = parsed.searchParams.toString();
      return `${parsed.protocol}//${hostname}${pathname}${search ? '?' + search : ''}`;
    } catch {
      // If URL parsing fails, return as-is lowercase
      return url.toLowerCase();
    }
  }

  fingerprint(text: string): string {
    // Clean and normalize text
    const cleaned = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract words (excluding very short ones)
    const words = cleaned.split(' ').filter((w) => w.length > 2);

    if (words.length < 3) {
      // For very short text, just use the cleaned text
      return cleaned;
    }

    // Generate word trigrams
    const trigrams = new Set<string>();
    for (let i = 0; i < words.length - 2; i++) {
      const w1 = words[i];
      const w2 = words[i + 1];
      const w3 = words[i + 2];
      if (w1 && w2 && w3) {
        // Sort words in trigram for order-independent matching
        trigrams.add([w1, w2, w3].sort().join(''));
      }
    }

    // Take first N trigrams sorted for deterministic fingerprint
    return [...trigrams].sort().slice(0, 10).join('|');
  }

  computeSimilarity(a: string, b: string): number {
    const aFingerprint = this.fingerprint(a);
    const bFingerprint = this.fingerprint(b);

    const aTrigrams = new Set(aFingerprint.split('|'));
    const bTrigrams = new Set(bFingerprint.split('|'));

    if (aTrigrams.size === 0 || bTrigrams.size === 0) {
      return 0;
    }

    // Jaccard similarity
    const intersection = [...aTrigrams].filter((t) => bTrigrams.has(t)).length;
    const union = new Set([...aTrigrams, ...bTrigrams]).size;

    return union > 0 ? intersection / union : 0;
  }

  findSimilar(results: SearchResult[], threshold?: number): Map<number, number[]> {
    const similarityThreshold = threshold ?? this.config.similarityThreshold;
    const similar = new Map<number, number[]>();

    for (let i = 0; i < results.length; i++) {
      const resultI = results[i];
      if (!resultI) continue;
      const textI = resultI.title + ' ' + resultI.snippet;

      for (let j = i + 1; j < results.length; j++) {
        const resultJ = results[j];
        if (!resultJ) continue;
        const textJ = resultJ.title + ' ' + resultJ.snippet;

        const similarity = this.computeSimilarity(textI, textJ);

        if (similarity >= similarityThreshold) {
          if (!similar.has(i)) {
            similar.set(i, []);
          }
          similar.get(i)!.push(j);
        }
      }
    }

    return similar;
  }
}
