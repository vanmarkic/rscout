#!/usr/bin/env node

import { Command } from 'commander';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve, join } from 'path';
import { homedir } from 'os';

import { loadConfig, mergeConfigWithCLI } from './config/loader.js';
import type { Config } from './config/schema.js';
import { DuckDuckGoProvider, BraveProvider, RSSProvider, SerpProvider } from './providers/index.js';
import type { Provider, ProviderName, SearchOptions, AggregatedResults } from './providers/types.js';
import { Fetcher, Deduplicator, Scorer, Categorizer, QueryRefiner, formatSuggestionsForDisplay } from './pipeline/index.js';
import { MarkdownGenerator, JsonGenerator } from './output/index.js';
import { FileCache } from './utils/cache.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { createChildLogger } from './utils/logger.js';
import { runInteractiveSearch } from './interactive.js';

const cliLogger = createChildLogger('cli');

const program = new Command();

program
  .name('rscout')
  .description('Resource Scout - A lightweight web resource finder and aggregator CLI tool')
  .version('1.0.0');

// Search command
program
  .command('search')
  .description('Search for resources across multiple providers')
  .argument('<query>', 'Search query')
  .option('-l, --limit <number>', 'Maximum number of results', '20')
  .option('-p, --providers <providers>', 'Comma-separated list of providers (brave,duckduckgo,rss,serp)')
  .option('-d, --domains <domains>', 'Comma-separated list of domains to include')
  .option('-x, --exclude-domains <domains>', 'Comma-separated list of domains to exclude')
  .option('-s, --since <date>', 'Only include results since this date (YYYY-MM-DD)')
  .option('-u, --until <date>', 'Only include results until this date (YYYY-MM-DD)')
  .option('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'Output format: markdown or json', 'markdown')
  .option('-c, --config <path>', 'Path to config file')
  .option('--no-cache', 'Disable caching')
  .option('--group-by <type>', 'Group results by: domain, category, or none', 'domain')
  .action(async (query: string, options) => {
    try {
      const config = await loadConfig(options.config);
      const mergedConfig = mergeConfigWithCLI(config, {
        providers: options.providers?.split(','),
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
        output: options.output ? dirname(options.output) : undefined,
        format: options.format,
      });

      const result = await executeSearch(query, mergedConfig, {
        domains: options.domains?.split(','),
        excludeDomains: options.excludeDomains?.split(','),
        dateRange: parseDateRange(options.since, options.until),
        cacheEnabled: options.cache !== false,
        groupBy: options.groupBy,
      });

      // Generate output
      const output = await generateOutput(result, query, mergedConfig, {
        format: options.format as 'markdown' | 'json',
        groupBy: options.groupBy,
      });

      // Write to file or stdout
      if (options.output) {
        const outputPath = resolveOutputPath(options.output, mergedConfig);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, output);
        console.log(`Output written to: ${outputPath}`);
      } else {
        console.log(output);
      }

      // Log summary
      cliLogger.info({
        query,
        results: result.totalResults,
        providers: result.providers,
        errors: result.errors.length,
      }, 'Search complete');

    } catch (error) {
      cliLogger.error({ error }, 'Search failed');
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Feeds command - RSS only
program
  .command('feeds')
  .description('Aggregate content from RSS feeds')
  .option('-q, --query <query>', 'Filter feed items by query')
  .option('-l, --limit <number>', 'Maximum number of results', '50')
  .option('-o, --output <path>', 'Output file path')
  .option('-f, --format <format>', 'Output format: markdown or json', 'markdown')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);

      if (!config.providers.rss.feeds || config.providers.rss.feeds.length === 0) {
        console.error('No RSS feeds configured. Add feeds to your config file.');
        process.exit(1);
      }

      const query = options.query ?? '';
      const modifiedConfig: Config = {
        ...config,
        providers: {
          ...config.providers,
          brave: { ...config.providers.brave, enabled: false },
          duckduckgo: { ...config.providers.duckduckgo, enabled: false },
          serp: { ...config.providers.serp, enabled: false },
          rss: { ...config.providers.rss, enabled: true },
        },
        search: {
          ...config.search,
          defaultLimit: options.limit ? parseInt(options.limit, 10) : 50,
        },
      };

      const result = await executeSearch(query, modifiedConfig, {
        cacheEnabled: true,
      });

      const output = await generateOutput(result, query || 'RSS Feed Aggregation', modifiedConfig, {
        format: options.format as 'markdown' | 'json',
      });

      if (options.output) {
        const outputPath = resolveOutputPath(options.output, modifiedConfig);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, output);
        console.log(`Output written to: ${outputPath}`);
      } else {
        console.log(output);
      }

    } catch (error) {
      cliLogger.error({ error }, 'Feed aggregation failed');
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Check the health of all configured providers')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      const providers = createProviders(config);

      console.log('Checking provider status...\n');

      for (const provider of providers) {
        const status = await provider.healthCheck();
        const icon = status ? '✓' : '✗';
        const statusText = status ? 'OK' : 'FAILED';
        console.log(`  ${icon} ${provider.name}: ${statusText}`);
      }

      console.log('');

    } catch (error) {
      cliLogger.error({ error }, 'Status check failed');
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Interactive command
program
  .command('interactive')
  .alias('i')
  .description('Interactive search with progressive refinement')
  .argument('<query>', 'Initial search query')
  .option('-d, --depth <number>', 'Maximum refinement depth', '3')
  .option('-l, --limit <number>', 'Results per search round', '10')
  .option('-f, --format <format>', 'Output format: markdown or json', 'markdown')
  .option('-o, --output <path>', 'Output file path (for final export)')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (query: string, options) => {
    try {
      const config = await loadConfig(options.config);

      const result = await runInteractiveSearch({
        initialQuery: query,
        config,
        maxDepth: options.depth ? parseInt(options.depth, 10) : 3,
        resultsPerRound: options.limit ? parseInt(options.limit, 10) : 10,
        outputFormat: options.format as 'markdown' | 'json',
      });

      // If output path specified, write results
      if (options.output) {
        const output = await generateOutput(result, query, config, {
          format: options.format as 'markdown' | 'json',
        });
        const outputPath = resolveOutputPath(options.output, config);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, output);
        console.log(`\nResults written to: ${outputPath}`);
      }

      cliLogger.info({
        query,
        results: result.totalResults,
        providers: result.providers,
      }, 'Interactive search complete');

    } catch (error) {
      cliLogger.error({ error }, 'Interactive search failed');
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Refine command - single round refinement with suggestions
program
  .command('refine')
  .description('Get refinement suggestions for a query based on initial results')
  .argument('<query>', 'Search query')
  .option('-l, --limit <number>', 'Number of results to analyze', '20')
  .option('-s, --suggestions <number>', 'Number of suggestions to show', '10')
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output suggestions as JSON')
  .action(async (query: string, options) => {
    try {
      const config = await loadConfig(options.config);
      const mergedConfig = mergeConfigWithCLI(config, {
        limit: options.limit ? parseInt(options.limit, 10) : 20,
      });

      console.log(`Searching for "${query}" to generate refinement suggestions...\n`);

      const result = await executeSearch(query, mergedConfig, {
        cacheEnabled: true,
      });

      if (result.totalResults === 0) {
        console.log('No results found. Cannot generate refinement suggestions.');
        process.exit(1);
      }

      console.log(`Analyzed ${result.totalResults} results.\n`);

      const refiner = new QueryRefiner(query, {
        maxSuggestions: options.suggestions ? parseInt(options.suggestions, 10) : 10,
        excludeOriginalTerms: true,
        includeNgrams: true,
      });

      const suggestions = refiner.extractSuggestions(result.results);

      if (options.json) {
        console.log(JSON.stringify({
          query,
          results: result.totalResults,
          suggestions: suggestions.map(s => ({
            term: s.term,
            score: Math.round(s.score * 100) / 100,
            source: s.source,
            frequency: s.frequency,
          })),
          refinedQueries: {
            expand: refiner.buildRefinedQueries(suggestions.slice(0, 3).map(s => s.term), 'expand'),
            narrow: refiner.buildRefinedQueries(suggestions.slice(0, 3).map(s => s.term), 'narrow'),
            pivot: refiner.buildRefinedQueries(suggestions.slice(0, 3).map(s => s.term), 'pivot'),
          },
        }, null, 2));
      } else {
        console.log(formatSuggestionsForDisplay(suggestions));

        // Show example refined queries
        const topTerms = suggestions.slice(0, 3).map(s => s.term);
        if (topTerms.length > 0) {
          console.log('Example refined queries:\n');
          console.log('  Expand (broaden search):');
          refiner.buildRefinedQueries(topTerms, 'expand').slice(0, 2).forEach(q => {
            console.log(`    rscout search "${q}"`);
          });
          console.log('\n  Narrow (focus search):');
          refiner.buildRefinedQueries(topTerms, 'narrow').slice(0, 2).forEach(q => {
            console.log(`    rscout search "${q}"`);
          });
          console.log('\n  Pivot (new direction):');
          refiner.buildRefinedQueries(topTerms, 'pivot').slice(0, 2).forEach(q => {
            console.log(`    rscout search "${q}"`);
          });
          console.log('');
        }
      }

    } catch (error) {
      cliLogger.error({ error }, 'Refinement failed');
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Cache commands
const cacheCmd = program.command('cache').description('Manage the result cache');

cacheCmd
  .command('clear')
  .description('Clear all cached results')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const cache = new FileCache(config.cache.directory, config.cache.ttlMs);
    await cache.clear();
    console.log('Cache cleared');
  });

cacheCmd
  .command('prune')
  .description('Remove expired cache entries')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const cache = new FileCache(config.cache.directory, config.cache.ttlMs);
    const pruned = await cache.prune();
    console.log(`Pruned ${pruned} expired entries`);
  });

cacheCmd
  .command('stats')
  .description('Show cache statistics')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    const config = await loadConfig(options.config);
    const cache = new FileCache(config.cache.directory, config.cache.ttlMs);
    const stats = await cache.stats();
    console.log(`Cache entries: ${stats.entries}`);
    console.log(`Cache size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
  });

// Parse the CLI
program.parse();

// Helper functions

function createProviders(config: Config): Provider[] {
  const providers: Provider[] = [];

  if (config.providers.duckduckgo.enabled) {
    const rateLimiter = new RateLimiter('duckduckgo', config.providers.duckduckgo.rateLimit);
    providers.push(new DuckDuckGoProvider(rateLimiter));
  }

  if (config.providers.brave.enabled && config.providers.brave.apiKey) {
    const rateLimiter = new RateLimiter('brave', config.providers.brave.rateLimit);
    providers.push(new BraveProvider(config.providers.brave.apiKey, rateLimiter));
  }

  if (config.providers.rss.enabled && config.providers.rss.feeds.length > 0) {
    const rateLimiter = new RateLimiter('rss', config.providers.rss.rateLimit);
    providers.push(new RSSProvider(config.providers.rss.feeds, rateLimiter));
  }

  if (config.providers.serp.enabled && config.providers.serp.apiKey) {
    const rateLimiter = new RateLimiter('serp', config.providers.serp.rateLimit);
    providers.push(new SerpProvider(config.providers.serp.apiKey, rateLimiter));
  }

  return providers;
}

interface SearchExecOptions {
  domains?: string[];
  excludeDomains?: string[];
  dateRange?: { from: Date; to: Date };
  cacheEnabled?: boolean;
  groupBy?: string;
}

async function executeSearch(
  query: string,
  config: Config,
  execOptions: SearchExecOptions
): Promise<AggregatedResults> {
  const providers = createProviders(config);

  if (providers.length === 0) {
    throw new Error('No providers enabled. Check your configuration.');
  }

  // Set up cache
  const cache = config.cache.enabled && execOptions.cacheEnabled !== false
    ? new FileCache(config.cache.directory, config.cache.ttlMs)
    : undefined;

  // Set up fetcher
  const fetcher = new Fetcher({
    retries: config.search.retries,
    cache,
    cacheEnabled: config.cache.enabled && execOptions.cacheEnabled !== false,
  });

  // Fetch results
  const searchOptions: SearchOptions = {
    limit: config.search.defaultLimit,
    timeout: config.search.timeout,
    domains: execOptions.domains,
    excludeDomains: execOptions.excludeDomains,
    dateRange: execOptions.dateRange,
  };

  const fetchResult = await fetcher.fetchAll(providers, query, searchOptions);

  // Deduplicate
  const deduplicator = new Deduplicator(config.deduplication);
  const uniqueResults = deduplicator.deduplicate(fetchResult.results);

  // Score
  const scorer = new Scorer(config.scoring);
  const scoredResults = scorer.scoreAll(uniqueResults, query);

  // Categorize
  const categorizer = new Categorizer();
  const categorizedResults = categorizer.categorize(scoredResults);

  return {
    query,
    timestamp: new Date(),
    providers: fetchResult.providers,
    totalResults: categorizedResults.length,
    results: categorizedResults,
    errors: fetchResult.errors,
  };
}

interface OutputOptions {
  format: 'markdown' | 'json';
  groupBy?: string;
}

async function generateOutput(
  result: AggregatedResults,
  query: string,
  config: Config,
  options: OutputOptions
): Promise<string> {
  if (options.format === 'json') {
    const generator = new JsonGenerator();
    return generator.generate(result.results, {
      query,
      providers: result.providers,
      errors: result.errors,
    });
  }

  const generator = new MarkdownGenerator(config.output);
  return generator.generate(result.results, {
    query,
    providers: result.providers,
    totalResults: result.totalResults,
    tags: config.output.obsidian.tags,
    groupBy: options.groupBy as 'domain' | 'category' | 'none',
  });
}

function parseDateRange(
  since?: string,
  until?: string
): { from: Date; to: Date } | undefined {
  if (!since && !until) {
    return undefined;
  }

  const from = since ? new Date(since) : new Date(0);
  const to = until ? new Date(until) : new Date();

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD.');
  }

  return { from, to };
}

function resolveOutputPath(path: string, config: Config): string {
  // Expand ~ to home directory
  if (path.startsWith('~')) {
    path = join(homedir(), path.slice(1));
  }

  // If path is absolute, use as-is
  if (path.startsWith('/')) {
    return path;
  }

  // Otherwise, resolve relative to config output directory
  return resolve(config.output.directory, path);
}
