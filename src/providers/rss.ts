import Parser from 'rss-parser';
import type { Provider, SearchResult, SearchOptions, ProviderName } from './types.js';
import { ProviderError } from '../utils/errors.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('rss');

interface FeedItem {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  pubDate?: string;
  isoDate?: string;
  creator?: string;
  author?: string;
  categories?: string[];
  guid?: string;
}

interface Feed {
  title?: string;
  description?: string;
  link?: string;
  items: FeedItem[];
}

export class RSSProvider implements Provider {
  readonly name: ProviderName = 'rss';
  private parser: Parser;

  constructor(
    private feeds: string[],
    private rateLimiter: RateLimiter
  ) {
    this.parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'rscout/1.0 (Resource Aggregator CLI)',
      },
    });
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);

    logger.debug({ feeds: this.feeds.length, query }, 'Fetching RSS feeds');

    for (const feedUrl of this.feeds) {
      if (results.length >= options.limit) break;

      await this.rateLimiter.acquire();

      try {
        const feed = await this.fetchFeed(feedUrl, options.timeout ?? 10000);
        const matchingItems = this.filterItems(feed, queryTerms, options);

        for (const item of matchingItems) {
          if (results.length >= options.limit) break;

          const result = this.normalizeItem(item, feedUrl, feed.title);
          if (result) {
            results.push(result);
          }
        }

        logger.debug({ feedUrl, items: matchingItems.length }, 'Feed processed');
      } catch (error) {
        logger.warn({ feedUrl, error }, 'Failed to fetch feed');
        // Continue with other feeds
      }
    }

    logger.debug({ count: results.length }, 'RSS results collected');
    return results;
  }

  async healthCheck(): Promise<boolean> {
    if (this.feeds.length === 0) {
      return true; // No feeds configured is valid
    }

    try {
      // Just try to parse the first feed
      const firstFeed = this.feeds[0];
      if (firstFeed) {
        await this.parser.parseURL(firstFeed);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async fetchFeed(url: string, timeout: number): Promise<Feed> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const feed = await this.parser.parseURL(url);
      return feed as Feed;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private filterItems(
    feed: Feed,
    queryTerms: string[],
    options: SearchOptions
  ): FeedItem[] {
    return feed.items.filter((item) => {
      // Text matching
      const text = `${item.title ?? ''} ${item.contentSnippet ?? ''} ${item.summary ?? ''}`.toLowerCase();
      const matchesQuery = queryTerms.length === 0 || queryTerms.some((term) => text.includes(term));

      if (!matchesQuery) return false;

      // Date range filter
      if (options.dateRange && item.isoDate) {
        const itemDate = new Date(item.isoDate);
        if (itemDate < options.dateRange.from || itemDate > options.dateRange.to) {
          return false;
        }
      }

      // Domain filter (for feed URL)
      if (item.link && options.domains?.length) {
        try {
          const hostname = new URL(item.link).hostname.replace('www.', '');
          if (!options.domains.some((d) => hostname.includes(d))) {
            return false;
          }
        } catch {
          return false;
        }
      }

      if (item.link && options.excludeDomains?.length) {
        try {
          const hostname = new URL(item.link).hostname.replace('www.', '');
          if (options.excludeDomains.some((d) => hostname.includes(d))) {
            return false;
          }
        } catch {
          // Keep item if URL parsing fails
        }
      }

      return true;
    });
  }

  private normalizeItem(
    item: FeedItem,
    feedUrl: string,
    feedTitle?: string
  ): SearchResult | null {
    if (!item.link) {
      return null;
    }

    const snippet = item.contentSnippet ?? item.summary ?? item.content ?? '';
    const cleanSnippet = snippet
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .slice(0, 500);

    return {
      url: item.link,
      title: item.title ?? 'Untitled',
      snippet: cleanSnippet,
      source: this.name,
      timestamp: item.isoDate ? new Date(item.isoDate) : new Date(),
      metadata: {
        feedUrl,
        feedTitle,
        author: item.creator ?? item.author,
        categories: item.categories,
        guid: item.guid,
      },
    };
  }

  addFeed(url: string): void {
    if (!this.feeds.includes(url)) {
      this.feeds.push(url);
    }
  }

  removeFeed(url: string): void {
    const index = this.feeds.indexOf(url);
    if (index > -1) {
      this.feeds.splice(index, 1);
    }
  }

  getFeeds(): string[] {
    return [...this.feeds];
  }
}
