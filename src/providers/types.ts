export type ProviderName = 'brave' | 'duckduckgo' | 'serp' | 'rss';

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  source: ProviderName;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  limit: number;
  timeout?: number;
  dateRange?: { from: Date; to: Date };
  domains?: string[];
  excludeDomains?: string[];
  locale?: string;
  signal?: AbortSignal;
}

export interface Provider {
  name: ProviderName;
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
  healthCheck(): Promise<boolean>;
}

export interface ScoredResult extends SearchResult {
  score: number;
}

export interface AggregatedResults {
  query: string;
  timestamp: Date;
  providers: ProviderName[];
  totalResults: number;
  results: ScoredResult[];
  errors: ProviderError[];
}

export interface ProviderError {
  provider: ProviderName;
  message: string;
  statusCode?: number;
}
