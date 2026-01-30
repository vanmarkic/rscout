import * as readline from 'readline';
import type { Config } from './config/schema.js';
import type { Provider, SearchOptions, SearchResult, AggregatedResults } from './providers/types.js';
import { DuckDuckGoProvider, BraveProvider, RSSProvider, SerpProvider } from './providers/index.js';
import { Fetcher, Deduplicator, Scorer, Categorizer } from './pipeline/index.js';
import { QueryRefiner, formatSuggestionsForDisplay, type RefinementSuggestion } from './pipeline/refiner.js';
import { MarkdownGenerator, JsonGenerator } from './output/index.js';
import { FileCache } from './utils/cache.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { createChildLogger } from './utils/logger.js';

const logger = createChildLogger('interactive');

export interface InteractiveOptions {
  initialQuery: string;
  config: Config;
  maxDepth?: number;
  resultsPerRound?: number;
  outputFormat?: 'markdown' | 'json';
}

export interface SearchRound {
  query: string;
  depth: number;
  results: SearchResult[];
  suggestions: RefinementSuggestion[];
}

export class InteractiveSearch {
  private rl: readline.Interface;
  private providers: Provider[];
  private cache?: FileCache;
  private allResults: SearchResult[] = [];
  private searchHistory: SearchRound[] = [];
  private deduplicator: Deduplicator;
  private scorer: Scorer;
  private categorizer: Categorizer;

  constructor(private options: InteractiveOptions) {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.providers = this.createProviders(options.config);
    this.deduplicator = new Deduplicator(options.config.deduplication);
    this.scorer = new Scorer(options.config.scoring);
    this.categorizer = new Categorizer();

    if (options.config.cache.enabled) {
      this.cache = new FileCache(
        options.config.cache.directory,
        options.config.cache.ttlMs
      );
    }
  }

  async run(): Promise<AggregatedResults> {
    console.log('\n🔍 Interactive Search Mode');
    console.log('══════════════════════════\n');
    console.log(`Starting query: "${this.options.initialQuery}"`);
    console.log(`Max depth: ${this.options.maxDepth ?? 3}`);
    console.log('\nCommands:');
    console.log('  [number]     - Select a suggestion by number');
    console.log('  [numbers]    - Select multiple (e.g., "1,3,5" or "1-3")');
    console.log('  /add <term>  - Add custom search term');
    console.log('  /query <q>   - Start fresh with new query');
    console.log('  /expand      - Expand search with selected terms');
    console.log('  /narrow      - Narrow search with selected terms');
    console.log('  /pivot       - Pivot to new direction with terms');
    console.log('  /results     - Show current aggregated results');
    console.log('  /export      - Export results and exit');
    console.log('  /done        - Finish and return results');
    console.log('  /quit        - Exit without saving\n');

    try {
      await this.searchLoop(this.options.initialQuery, 0);
    } finally {
      this.rl.close();
    }

    return this.buildFinalResults();
  }

  private async searchLoop(query: string, depth: number): Promise<void> {
    const maxDepth = this.options.maxDepth ?? 3;

    if (depth >= maxDepth) {
      console.log(`\n⚠️  Maximum depth (${maxDepth}) reached.`);
      const continueDeeper = await this.prompt('Continue deeper? (y/n): ');
      if (continueDeeper.toLowerCase() !== 'y') {
        return;
      }
    }

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Depth ${depth + 1}: Searching for "${query}"...`);

    const results = await this.executeSearch(query);

    if (results.length === 0) {
      console.log('No results found for this query.');
      const action = await this.prompt('Enter new query or /done: ');
      await this.handleCommand(action, query, depth);
      return;
    }

    // Add to all results (deduplicated)
    const newResults = this.deduplicator.deduplicate([...this.allResults, ...results]);
    const addedCount = newResults.length - this.allResults.length;
    this.allResults = newResults;

    console.log(`\n✓ Found ${results.length} results (${addedCount} new, ${this.allResults.length} total)`);

    // Show top results preview
    this.showResultsPreview(results.slice(0, 5));

    // Extract refinement suggestions
    const refiner = new QueryRefiner(query, {
      maxSuggestions: 10,
      excludeOriginalTerms: true,
      includeNgrams: true,
    });
    const suggestions = refiner.extractSuggestions(results);

    // Store this round
    this.searchHistory.push({ query, depth, results, suggestions });

    // Show suggestions
    console.log(formatSuggestionsForDisplay(suggestions));

    // Interactive loop for this depth
    while (true) {
      const input = await this.prompt('Select refinements or command: ');
      const shouldContinue = await this.handleCommand(input, query, depth, suggestions, refiner);
      if (!shouldContinue) break;
    }
  }

  private async handleCommand(
    input: string,
    currentQuery: string,
    depth: number,
    suggestions?: RefinementSuggestion[],
    refiner?: QueryRefiner
  ): Promise<boolean> {
    const trimmed = input.trim();

    if (!trimmed) return true;

    // Handle commands
    if (trimmed.startsWith('/')) {
      const [cmd, ...args] = trimmed.slice(1).split(' ');
      const arg = args.join(' ');

      switch (cmd?.toLowerCase()) {
        case 'done':
        case 'finish':
          return false;

        case 'quit':
        case 'exit':
          console.log('Exiting without saving.');
          process.exit(0);

        case 'add':
          if (arg) {
            console.log(`Adding custom term: "${arg}"`);
            await this.searchLoop(`${currentQuery} ${arg}`, depth + 1);
            return false;
          }
          console.log('Usage: /add <term>');
          return true;

        case 'query':
          if (arg) {
            console.log(`Starting fresh with: "${arg}"`);
            await this.searchLoop(arg, 0);
            return false;
          }
          console.log('Usage: /query <new query>');
          return true;

        case 'expand':
          if (refiner && this.selectedTerms.length > 0) {
            const queries = refiner.buildRefinedQueries(this.selectedTerms, 'expand');
            for (const q of queries.slice(0, 3)) {
              await this.searchLoop(q, depth + 1);
            }
            return false;
          }
          console.log('Select some terms first, then use /expand');
          return true;

        case 'narrow':
          if (refiner && this.selectedTerms.length > 0) {
            const queries = refiner.buildRefinedQueries(this.selectedTerms, 'narrow');
            for (const q of queries.slice(0, 2)) {
              await this.searchLoop(q, depth + 1);
            }
            return false;
          }
          console.log('Select some terms first, then use /narrow');
          return true;

        case 'pivot':
          if (refiner && this.selectedTerms.length > 0) {
            const queries = refiner.buildRefinedQueries(this.selectedTerms, 'pivot');
            await this.searchLoop(queries[0] ?? this.selectedTerms[0] ?? currentQuery, depth + 1);
            return false;
          }
          console.log('Select some terms first, then use /pivot');
          return true;

        case 'results':
          this.showAllResults();
          return true;

        case 'export':
          await this.exportResults();
          return false;

        case 'history':
          this.showHistory();
          return true;

        case 'help':
          this.showHelp();
          return true;

        default:
          console.log(`Unknown command: ${cmd}. Type /help for commands.`);
          return true;
      }
    }

    // Handle number selection
    if (suggestions && suggestions.length > 0) {
      const selected = this.parseSelection(trimmed, suggestions.length);
      if (selected.length > 0) {
        const terms = selected.map(i => suggestions[i - 1]?.term).filter((t): t is string => !!t);
        this.selectedTerms = terms;
        console.log(`Selected: ${terms.join(', ')}`);

        // Ask for strategy
        const strategy = await this.prompt('Strategy - (e)xpand, (n)arrow, (p)ivot, or enter for expand: ');
        const strat = strategy.toLowerCase().startsWith('n') ? 'narrow'
          : strategy.toLowerCase().startsWith('p') ? 'pivot'
          : 'expand';

        const refinerInstance = refiner ?? new QueryRefiner(currentQuery);
        const queries = refinerInstance.buildRefinedQueries(terms, strat);

        for (const q of queries.slice(0, 3)) {
          await this.searchLoop(q, depth + 1);
        }
        return false;
      }
    }

    // Treat as custom term
    console.log(`Searching with custom term: "${trimmed}"`);
    await this.searchLoop(`${currentQuery} ${trimmed}`, depth + 1);
    return false;
  }

  private selectedTerms: string[] = [];

  private parseSelection(input: string, max: number): number[] {
    const numbers: number[] = [];

    // Handle comma-separated: "1,3,5"
    // Handle ranges: "1-3"
    // Handle mixed: "1,3-5,7"
    const parts = input.split(',').map(p => p.trim());

    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
        if (start && end && !isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end && i <= max; i++) {
            if (i >= 1) numbers.push(i);
          }
        }
      } else {
        const num = parseInt(part, 10);
        if (!isNaN(num) && num >= 1 && num <= max) {
          numbers.push(num);
        }
      }
    }

    return [...new Set(numbers)].sort((a, b) => a - b);
  }

  private async executeSearch(query: string): Promise<SearchResult[]> {
    const fetcher = new Fetcher({
      retries: this.options.config.search.retries,
      cache: this.cache,
      cacheEnabled: this.options.config.cache.enabled,
    });

    const searchOptions: SearchOptions = {
      limit: this.options.resultsPerRound ?? this.options.config.search.defaultLimit,
      timeout: this.options.config.search.timeout,
    };

    const result = await fetcher.fetchAll(this.providers, query, searchOptions);

    if (result.errors.length > 0) {
      console.log(`⚠️  ${result.errors.length} provider(s) had errors`);
    }

    return result.results;
  }

  private showResultsPreview(results: SearchResult[]): void {
    console.log('\nTop results:');
    results.forEach((r, i) => {
      const domain = new URL(r.url).hostname.replace('www.', '');
      console.log(`  ${i + 1}. [${domain}] ${r.title.slice(0, 60)}${r.title.length > 60 ? '...' : ''}`);
    });
  }

  private showAllResults(): void {
    console.log(`\n📊 All aggregated results (${this.allResults.length} total):\n`);

    const scored = this.scorer.scoreAll(this.allResults, this.options.initialQuery);
    scored.slice(0, 20).forEach((r, i) => {
      const domain = new URL(r.url).hostname.replace('www.', '');
      const score = Math.round(r.score * 100);
      console.log(`  ${(i + 1).toString().padStart(2)}. [${score}%] [${domain.padEnd(20)}] ${r.title.slice(0, 50)}`);
    });

    if (this.allResults.length > 20) {
      console.log(`  ... and ${this.allResults.length - 20} more`);
    }
  }

  private showHistory(): void {
    console.log('\n📜 Search history:\n');
    this.searchHistory.forEach((round, i) => {
      console.log(`  ${i + 1}. [Depth ${round.depth}] "${round.query}" → ${round.results.length} results`);
    });
  }

  private showHelp(): void {
    console.log(`
Commands:
  [number]      Select suggestion by number (e.g., "3")
  [numbers]     Select multiple (e.g., "1,3,5" or "1-3")
  [text]        Add as custom search term

  /add <term>   Add custom term to current query
  /query <q>    Start fresh with entirely new query
  /expand       Expand search with selected terms (OR-like)
  /narrow       Narrow search with selected terms (AND-like)
  /pivot        Pivot to new direction using selected terms
  /results      Show all aggregated results
  /history      Show search history
  /export       Export results and exit
  /done         Finish and return results
  /quit         Exit without saving
  /help         Show this help
    `);
  }

  private async exportResults(): Promise<void> {
    const format = this.options.outputFormat ?? 'markdown';
    const results = this.buildFinalResults();

    let output: string;
    if (format === 'json') {
      const generator = new JsonGenerator();
      output = generator.generate(results.results, {
        query: this.options.initialQuery,
        providers: results.providers,
        errors: results.errors,
      });
    } else {
      const generator = new MarkdownGenerator(this.options.config.output);
      output = generator.generate(results.results, {
        query: this.options.initialQuery,
        providers: results.providers,
        totalResults: results.totalResults,
        tags: [...this.options.config.output.obsidian.tags, 'interactive-search'],
      });
    }

    console.log('\n' + '═'.repeat(50));
    console.log(output);
    console.log('═'.repeat(50) + '\n');
  }

  private buildFinalResults(): AggregatedResults {
    const scored = this.scorer.scoreAll(this.allResults, this.options.initialQuery);
    const categorized = this.categorizer.categorize(scored);

    const providers = [...new Set(this.allResults.map(r => r.source))];

    return {
      query: this.options.initialQuery,
      timestamp: new Date(),
      providers,
      totalResults: categorized.length,
      results: categorized,
      errors: [],
    };
  }

  private createProviders(config: Config): Provider[] {
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

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }
}

export async function runInteractiveSearch(options: InteractiveOptions): Promise<AggregatedResults> {
  const search = new InteractiveSearch(options);
  return search.run();
}
