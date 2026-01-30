import type { Provider, SearchResult, SearchOptions, ProviderName } from './types.js';
import { ProviderError } from '../utils/errors.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('serp');

interface SerpApiResponse {
  search_metadata: {
    id: string;
    status: string;
    json_endpoint: string;
    created_at: string;
    processed_at: string;
    google_url: string;
    raw_html_file: string;
    total_time_taken: number;
  };
  search_parameters: {
    q: string;
    engine: string;
    google_domain: string;
    device: string;
  };
  search_information?: {
    organic_results_state: string;
    query_displayed: string;
    total_results: number;
    time_taken_displayed: number;
  };
  organic_results?: SerpOrganicResult[];
  error?: string;
}

interface SerpOrganicResult {
  position: number;
  title: string;
  link: string;
  displayed_link: string;
  thumbnail?: string;
  favicon?: string;
  snippet?: string;
  snippet_highlighted_words?: string[];
  sitelinks?: {
    inline?: Array<{ title: string; link: string }>;
    expanded?: Array<{ title: string; link: string; snippet: string }>;
  };
  rich_snippet?: {
    top?: {
      detected_extensions?: Record<string, unknown>;
      extensions?: string[];
    };
    bottom?: {
      detected_extensions?: Record<string, unknown>;
      extensions?: string[];
    };
  };
  date?: string;
  source?: string;
}

export class SerpProvider implements Provider {
  readonly name: ProviderName = 'serp';
  private readonly baseUrl = 'https://serpapi.com/search.json';

  constructor(
    private apiKey: string,
    private rateLimiter: RateLimiter
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    await this.rateLimiter.acquire();

    const params = new URLSearchParams({
      q: query,
      api_key: this.apiKey,
      engine: 'google',
      num: Math.min(options.limit, 100).toString(),
    });

    if (options.locale) {
      params.set('gl', options.locale);
      params.set('hl', options.locale);
    }

    const url = `${this.baseUrl}?${params.toString()}`;
    logger.debug({ query }, 'Fetching SerpAPI results');

    try {
      const response = await fetch(url, {
        signal: options.signal ?? AbortSignal.timeout(options.timeout ?? 10000),
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new ProviderError(
          this.name,
          `HTTP ${response.status}: ${text}`,
          response.status
        );
      }

      const data = await response.json() as SerpApiResponse;

      if (data.error) {
        throw new ProviderError(this.name, data.error);
      }

      return this.normalize(data, options);
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
      const params = new URLSearchParams({
        q: 'test',
        api_key: this.apiKey,
        engine: 'google',
        num: '1',
      });

      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'Accept': 'application/json',
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private normalize(data: SerpApiResponse, options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];

    if (!data.organic_results) {
      return results;
    }

    for (const result of data.organic_results) {
      if (results.length >= options.limit) break;

      // Apply domain filters
      if (options.domains?.length) {
        try {
          const hostname = new URL(result.link).hostname.replace('www.', '');
          if (!options.domains.some((d) => hostname.includes(d))) {
            continue;
          }
        } catch {
          continue;
        }
      }

      if (options.excludeDomains?.length) {
        try {
          const hostname = new URL(result.link).hostname.replace('www.', '');
          if (options.excludeDomains.some((d) => hostname.includes(d))) {
            continue;
          }
        } catch {
          // Keep result if URL parsing fails
        }
      }

      const timestamp = result.date ? this.parseDate(result.date) : new Date();

      // Apply date range filter
      if (options.dateRange) {
        if (timestamp < options.dateRange.from || timestamp > options.dateRange.to) {
          continue;
        }
      }

      results.push({
        url: result.link,
        title: result.title,
        snippet: result.snippet ?? '',
        source: this.name,
        timestamp,
        metadata: {
          position: result.position,
          displayedLink: result.displayed_link,
          favicon: result.favicon,
          thumbnail: result.thumbnail,
          highlightedWords: result.snippet_highlighted_words,
          sitelinks: result.sitelinks,
          richSnippet: result.rich_snippet,
        },
      });
    }

    logger.debug({ count: results.length }, 'SerpAPI results normalized');
    return results;
  }

  private parseDate(dateStr: string): Date {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // Handle relative dates
    const now = new Date();
    const match = dateStr.match(/(\d+)\s*(day|week|month|year)s?\s*ago/i);
    if (match) {
      const amount = parseInt(match[1] ?? '0', 10);
      const unit = match[2]?.toLowerCase();
      switch (unit) {
        case 'day':
          now.setDate(now.getDate() - amount);
          break;
        case 'week':
          now.setDate(now.getDate() - amount * 7);
          break;
        case 'month':
          now.setMonth(now.getMonth() - amount);
          break;
        case 'year':
          now.setFullYear(now.getFullYear() - amount);
          break;
      }
    }

    return now;
  }
}
