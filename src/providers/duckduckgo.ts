import type { Provider, SearchResult, SearchOptions, ProviderName } from './types.js';
import { ProviderError } from '../utils/errors.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('duckduckgo');

interface DDGInstantAnswer {
  Abstract: string;
  AbstractText: string;
  AbstractSource: string;
  AbstractURL: string;
  Image: string;
  Heading: string;
  Answer: string;
  AnswerType: string;
  Definition: string;
  DefinitionSource: string;
  DefinitionURL: string;
  RelatedTopics: DDGRelatedTopic[];
  Results: DDGResult[];
  Type: string;
  Redirect: string;
}

interface DDGRelatedTopic {
  Text?: string;
  FirstURL?: string;
  Icon?: { URL: string };
  Result?: string;
  Topics?: DDGRelatedTopic[];
  Name?: string;
}

interface DDGResult {
  Text: string;
  FirstURL: string;
  Icon?: { URL: string };
  Result: string;
}

export class DuckDuckGoProvider implements Provider {
  readonly name: ProviderName = 'duckduckgo';
  private readonly baseUrl = 'https://api.duckduckgo.com/';

  constructor(private rateLimiter: RateLimiter) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    await this.rateLimiter.acquire();

    const params = new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    });

    const url = `${this.baseUrl}?${params.toString()}`;
    logger.debug({ query, url }, 'Fetching DuckDuckGo Instant Answer');

    try {
      const response = await fetch(url, {
        signal: options.signal ?? AbortSignal.timeout(options.timeout ?? 10000),
        headers: {
          'User-Agent': 'rscout/1.0 (Resource Aggregator CLI)',
        },
      });

      if (!response.ok) {
        throw new ProviderError(
          this.name,
          `HTTP ${response.status}: ${response.statusText}`,
          response.status
        );
      }

      const data = await response.json() as DDGInstantAnswer;
      return this.normalize(data, options.limit);
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ProviderError(this.name, 'Request timed out');
      }
      throw new ProviderError(this.name, `Fetch failed: ${error}`, undefined, { cause: error });
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}?q=test&format=json`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private normalize(data: DDGInstantAnswer, limit: number): SearchResult[] {
    const results: SearchResult[] = [];
    const now = new Date();

    // Add main abstract if available
    if (data.AbstractURL && data.AbstractText) {
      results.push({
        url: data.AbstractURL,
        title: data.Heading || data.AbstractSource || 'DuckDuckGo Result',
        snippet: data.AbstractText,
        source: this.name,
        timestamp: now,
        metadata: {
          type: 'abstract',
          image: data.Image || undefined,
        },
      });
    }

    // Add answer if available
    if (data.Answer && data.AnswerType) {
      results.push({
        url: `https://duckduckgo.com/?q=${encodeURIComponent(data.Heading || '')}`,
        title: `Answer: ${data.AnswerType}`,
        snippet: data.Answer,
        source: this.name,
        timestamp: now,
        metadata: { type: 'answer' },
      });
    }

    // Add definition if available
    if (data.DefinitionURL && data.Definition) {
      results.push({
        url: data.DefinitionURL,
        title: `Definition from ${data.DefinitionSource || 'Unknown'}`,
        snippet: data.Definition,
        source: this.name,
        timestamp: now,
        metadata: { type: 'definition' },
      });
    }

    // Add direct results
    for (const result of data.Results) {
      if (results.length >= limit) break;
      if (result.FirstURL && result.Text) {
        results.push({
          url: result.FirstURL,
          title: this.extractTitle(result.Result) || result.Text.slice(0, 100),
          snippet: result.Text,
          source: this.name,
          timestamp: now,
          metadata: {
            type: 'result',
            icon: result.Icon?.URL,
          },
        });
      }
    }

    // Add related topics
    this.extractRelatedTopics(data.RelatedTopics, results, limit, now);

    logger.debug({ count: results.length }, 'DuckDuckGo results normalized');
    return results.slice(0, limit);
  }

  private extractRelatedTopics(
    topics: DDGRelatedTopic[],
    results: SearchResult[],
    limit: number,
    timestamp: Date
  ): void {
    for (const topic of topics) {
      if (results.length >= limit) break;

      if (topic.FirstURL && topic.Text) {
        results.push({
          url: topic.FirstURL,
          title: this.extractTitle(topic.Result ?? '') || topic.Text.slice(0, 100),
          snippet: topic.Text,
          source: this.name,
          timestamp,
          metadata: {
            type: 'related',
            icon: topic.Icon?.URL,
          },
        });
      }

      // Handle nested topics (categories)
      if (topic.Topics && topic.Topics.length > 0) {
        this.extractRelatedTopics(topic.Topics, results, limit, timestamp);
      }
    }
  }

  private extractTitle(html: string): string {
    // Extract title from HTML like: <a href="...">Title</a>Description
    const match = html.match(/<a[^>]*>([^<]+)<\/a>/);
    return match ? match[1] ?? '' : '';
  }
}
