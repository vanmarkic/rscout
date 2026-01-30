import type { Provider, SearchResult, SearchOptions, ProviderName } from './types.js';
import { ProviderError } from '../utils/errors.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('brave');

interface BraveSearchResponse {
  type: string;
  query: {
    original: string;
    show_strict_warning: boolean;
    is_navigational: boolean;
    local_decision: string;
    local_locations_idx: number;
    is_news_breaking: boolean;
    spellcheck_off: boolean;
    country: string;
    bad_results: boolean;
    should_fallback: boolean;
    postal_code: string;
    city: string;
    header_country: string;
    more_results_available: boolean;
    state: string;
  };
  mixed?: {
    type: string;
    main: Array<{ type: string; index: number; all: boolean }>;
    top: Array<{ type: string; index: number }>;
    side: Array<{ type: string; index: number }>;
  };
  web?: {
    type: string;
    results: BraveWebResult[];
    family_friendly_results: boolean;
  };
  news?: {
    type: string;
    results: BraveNewsResult[];
  };
}

interface BraveWebResult {
  title: string;
  url: string;
  is_source_local: boolean;
  is_source_both: boolean;
  description: string;
  page_age?: string;
  page_fetched?: string;
  profile?: {
    name: string;
    url: string;
    long_name: string;
    img: string;
  };
  language: string;
  family_friendly: boolean;
  type: string;
  subtype: string;
  meta_url?: {
    scheme: string;
    netloc: string;
    hostname: string;
    favicon: string;
    path: string;
  };
  thumbnail?: {
    src: string;
    original: string;
    logo: boolean;
  };
  age?: string;
  extra_snippets?: string[];
}

interface BraveNewsResult {
  title: string;
  url: string;
  description?: string;
  age: string;
  page_age: string;
  meta_url?: {
    scheme: string;
    netloc: string;
    hostname: string;
    favicon: string;
    path: string;
  };
  thumbnail?: {
    src: string;
  };
  extra_snippets?: string[];
}

export class BraveProvider implements Provider {
  readonly name: ProviderName = 'brave';
  private readonly baseUrl = 'https://api.search.brave.com/res/v1/web/search';

  constructor(
    private apiKey: string,
    private rateLimiter: RateLimiter
  ) {}

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    await this.rateLimiter.acquire();

    const params = new URLSearchParams({
      q: query,
      count: Math.min(options.limit, 20).toString(), // Brave API max is 20
    });

    if (options.locale) {
      params.set('country', options.locale);
    }

    const url = `${this.baseUrl}?${params.toString()}`;
    logger.debug({ query, url }, 'Fetching Brave Search results');

    try {
      const response = await fetch(url, {
        signal: options.signal ?? AbortSignal.timeout(options.timeout ?? 10000),
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': this.apiKey,
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

      const data = await response.json() as BraveSearchResponse;
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
      const response = await fetch(`${this.baseUrl}?q=test&count=1`, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': this.apiKey,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private normalize(data: BraveSearchResponse, options: SearchOptions): SearchResult[] {
    const results: SearchResult[] = [];

    // Process web results
    if (data.web?.results) {
      for (const result of data.web.results) {
        if (results.length >= options.limit) break;

        // Apply domain filters
        if (options.domains?.length) {
          const hostname = new URL(result.url).hostname.replace('www.', '');
          if (!options.domains.some((d) => hostname.includes(d))) {
            continue;
          }
        }

        if (options.excludeDomains?.length) {
          const hostname = new URL(result.url).hostname.replace('www.', '');
          if (options.excludeDomains.some((d) => hostname.includes(d))) {
            continue;
          }
        }

        const timestamp = result.page_age
          ? this.parseAge(result.page_age)
          : new Date();

        // Apply date range filter
        if (options.dateRange) {
          if (timestamp < options.dateRange.from || timestamp > options.dateRange.to) {
            continue;
          }
        }

        results.push({
          url: result.url,
          title: result.title,
          snippet: result.description,
          source: this.name,
          timestamp,
          metadata: {
            favicon: result.meta_url?.favicon,
            thumbnail: result.thumbnail?.src,
            language: result.language,
            age: result.age,
            extraSnippets: result.extra_snippets,
          },
        });
      }
    }

    // Process news results if available
    if (data.news?.results) {
      for (const result of data.news.results) {
        if (results.length >= options.limit) break;

        const timestamp = this.parseAge(result.page_age);

        if (options.dateRange) {
          if (timestamp < options.dateRange.from || timestamp > options.dateRange.to) {
            continue;
          }
        }

        results.push({
          url: result.url,
          title: result.title,
          snippet: result.description ?? '',
          source: this.name,
          timestamp,
          metadata: {
            type: 'news',
            favicon: result.meta_url?.favicon,
            thumbnail: result.thumbnail?.src,
            age: result.age,
          },
        });
      }
    }

    logger.debug({ count: results.length }, 'Brave results normalized');
    return results;
  }

  private parseAge(ageStr: string): Date {
    // Parse age strings like "2024-01-15T10:30:00Z" or relative like "2 days ago"
    const date = new Date(ageStr);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // Handle relative dates (rough approximation)
    const now = new Date();
    const match = ageStr.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
    if (match) {
      const amount = parseInt(match[1] ?? '0', 10);
      const unit = match[2]?.toLowerCase();
      switch (unit) {
        case 'second':
          now.setSeconds(now.getSeconds() - amount);
          break;
        case 'minute':
          now.setMinutes(now.getMinutes() - amount);
          break;
        case 'hour':
          now.setHours(now.getHours() - amount);
          break;
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
