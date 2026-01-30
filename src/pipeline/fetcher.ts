import pLimit from 'p-limit';
import pRetry from 'p-retry';
import type { Provider, SearchResult, SearchOptions, ProviderName, ProviderError as ProviderErrorType } from '../providers/types.js';
import { ProviderError } from '../utils/errors.js';
import { FileCache } from '../utils/cache.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('fetcher');

interface FetcherConfig {
  concurrency?: number;
  retries?: number;
  cache?: FileCache;
  cacheEnabled?: boolean;
}

interface FetchResult {
  results: SearchResult[];
  errors: ProviderErrorType[];
  providers: ProviderName[];
}

export class Fetcher {
  private concurrency: number;
  private retries: number;
  private cache?: FileCache;
  private cacheEnabled: boolean;

  constructor(config: FetcherConfig = {}) {
    this.concurrency = config.concurrency ?? 3;
    this.retries = config.retries ?? 2;
    this.cache = config.cache;
    this.cacheEnabled = config.cacheEnabled ?? true;
  }

  async fetchAll(
    providers: Provider[],
    query: string,
    options: SearchOptions
  ): Promise<FetchResult> {
    const limit = pLimit(this.concurrency);
    const results: SearchResult[] = [];
    const errors: ProviderErrorType[] = [];
    const successfulProviders: ProviderName[] = [];

    logger.info({ providers: providers.map((p) => p.name), query }, 'Starting parallel fetch');

    const tasks = providers.map((provider) =>
      limit(async () => {
        try {
          const providerResults = await this.fetchFromProvider(provider, query, options);
          results.push(...providerResults);
          successfulProviders.push(provider.name);
          logger.debug({ provider: provider.name, count: providerResults.length }, 'Provider fetch complete');
        } catch (error) {
          const providerError: ProviderErrorType = {
            provider: provider.name,
            message: error instanceof Error ? error.message : String(error),
            statusCode: error instanceof ProviderError ? error.statusCode : undefined,
          };
          errors.push(providerError);
          logger.warn({ provider: provider.name, error: providerError.message }, 'Provider fetch failed');
        }
      })
    );

    await Promise.all(tasks);

    logger.info({
      totalResults: results.length,
      successfulProviders: successfulProviders.length,
      failedProviders: errors.length,
    }, 'Fetch complete');

    return {
      results,
      errors,
      providers: successfulProviders,
    };
  }

  private async fetchFromProvider(
    provider: Provider,
    query: string,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const cacheKey = this.getCacheKey(provider.name, query, options);

    // Try cache first
    if (this.cache && this.cacheEnabled) {
      const cached = await this.cache.get<SearchResult[]>(cacheKey);
      if (cached) {
        logger.debug({ provider: provider.name }, 'Cache hit');
        // Convert date strings back to Date objects
        return cached.map((r) => ({
          ...r,
          timestamp: new Date(r.timestamp),
        }));
      }
    }

    // Fetch with retries
    const results = await pRetry(
      async () => {
        return provider.search(query, options);
      },
      {
        retries: this.retries,
        onFailedAttempt: (error) => {
          logger.debug(
            {
              provider: provider.name,
              attempt: error.attemptNumber,
              retriesLeft: error.retriesLeft,
            },
            'Retry attempt'
          );
        },
      }
    );

    // Cache results
    if (this.cache && this.cacheEnabled && results.length > 0) {
      await this.cache.set(cacheKey, results);
    }

    return results;
  }

  private getCacheKey(provider: ProviderName, query: string, options: SearchOptions): string {
    const optionsKey = JSON.stringify({
      limit: options.limit,
      domains: options.domains?.sort(),
      excludeDomains: options.excludeDomains?.sort(),
      locale: options.locale,
      dateRange: options.dateRange
        ? {
            from: options.dateRange.from.toISOString(),
            to: options.dateRange.to.toISOString(),
          }
        : undefined,
    });
    return `${provider}:${query}:${optionsKey}`;
  }
}
