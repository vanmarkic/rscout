import type { ScoredResult, ProviderName, ProviderError } from '../providers/types.js';
import type { CategorizedResult } from '../pipeline/categorizer.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('json');

export interface JsonOutputOptions {
  query: string;
  providers: ProviderName[];
  errors?: ProviderError[];
  pretty?: boolean;
}

export interface JsonOutput {
  meta: {
    query: string;
    timestamp: string;
    providers: ProviderName[];
    totalResults: number;
    uniqueDomains: number;
    version: string;
  };
  errors?: ProviderError[];
  results: JsonResult[];
}

export interface JsonResult {
  url: string;
  title: string;
  snippet: string;
  source: ProviderName;
  timestamp: string;
  score: number;
  domain: string;
  categories?: string[];
  metadata?: Record<string, unknown>;
}

export class JsonGenerator {
  generate(
    results: ScoredResult[] | CategorizedResult[],
    options: JsonOutputOptions
  ): string {
    const domains = new Set<string>();
    const jsonResults: JsonResult[] = [];

    for (const result of results) {
      let domain: string;
      try {
        domain = new URL(result.url).hostname.replace('www.', '');
        domains.add(domain);
      } catch {
        domain = 'unknown';
      }

      const jsonResult: JsonResult = {
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        source: result.source,
        timestamp: result.timestamp.toISOString(),
        score: Math.round(result.score * 100) / 100,
        domain,
        metadata: result.metadata,
      };

      if ('categories' in result) {
        jsonResult.categories = result.categories;
      }

      jsonResults.push(jsonResult);
    }

    const output: JsonOutput = {
      meta: {
        query: options.query,
        timestamp: new Date().toISOString(),
        providers: options.providers,
        totalResults: results.length,
        uniqueDomains: domains.size,
        version: '1.0.0',
      },
      results: jsonResults,
    };

    if (options.errors && options.errors.length > 0) {
      output.errors = options.errors;
    }

    logger.debug({ resultCount: results.length }, 'JSON generated');

    if (options.pretty ?? true) {
      return JSON.stringify(output, null, 2);
    }

    return JSON.stringify(output);
  }

  generateCompact(
    results: ScoredResult[],
    options: JsonOutputOptions
  ): string {
    // Generate a minimal JSON output for piping to other tools
    const output = results.map((r) => ({
      u: r.url,
      t: r.title,
      s: Math.round(r.score * 100),
    }));

    return JSON.stringify(output);
  }
}
