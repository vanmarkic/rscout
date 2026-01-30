import type { ScoredResult, ProviderName } from '../providers/types.js';
import type { CategorizedResult } from '../pipeline/categorizer.js';
import type { OutputConfig } from '../config/schema.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('markdown');

export interface MarkdownOptions {
  query: string;
  providers: ProviderName[];
  totalResults: number;
  tags?: string[];
  includeFrontmatter?: boolean;
  groupBy?: 'domain' | 'category' | 'none';
}

export class MarkdownGenerator {
  constructor(private config: OutputConfig) {}

  generate(
    results: ScoredResult[] | CategorizedResult[],
    options: MarkdownOptions
  ): string {
    const parts: string[] = [];

    // Generate frontmatter
    if (options.includeFrontmatter ?? this.config.obsidian.frontmatter) {
      parts.push(this.generateFrontmatter(options));
    }

    // Generate title
    parts.push(`# ${this.escapeMarkdown(options.query)}\n`);

    // Generate summary
    parts.push(this.generateSummary(results, options));

    // Generate body based on grouping
    const groupBy = options.groupBy ?? 'domain';
    if (groupBy === 'category' && this.isCategorizedResults(results)) {
      parts.push(this.generateBodyByCategory(results as CategorizedResult[]));
    } else if (groupBy === 'domain') {
      parts.push(this.generateBodyByDomain(results));
    } else {
      parts.push(this.generateFlatBody(results));
    }

    // Generate backlinks for Obsidian
    parts.push(this.generateBacklinks(results));

    logger.debug({ resultCount: results.length }, 'Markdown generated');
    return parts.join('\n');
  }

  private generateFrontmatter(options: MarkdownOptions): string {
    const tags = [...(options.tags ?? this.config.obsidian.tags)];
    const date = new Date().toISOString().split('T')[0];

    const frontmatter = [
      '---',
      `title: "${this.escapeFrontmatterValue(options.query)}"`,
      `date: ${date}`,
      `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
      `sources: [${options.providers.map((p) => `"${p}"`).join(', ')}]`,
      `total_results: ${options.totalResults}`,
      `generated_by: rscout`,
      '---',
      '',
    ];

    return frontmatter.join('\n');
  }

  private generateSummary(
    results: ScoredResult[],
    options: MarkdownOptions
  ): string {
    const domains = new Set<string>();
    for (const result of results) {
      try {
        const hostname = new URL(result.url).hostname.replace('www.', '');
        domains.add(hostname);
      } catch {
        // Skip invalid URLs
      }
    }

    return [
      '> **Summary**',
      `> - **Query**: ${options.query}`,
      `> - **Results**: ${results.length} unique results from ${options.providers.length} provider(s)`,
      `> - **Sources**: ${domains.size} unique domains`,
      `> - **Generated**: ${new Date().toLocaleString()}`,
      '',
    ].join('\n');
  }

  private generateBodyByDomain(results: ScoredResult[]): string {
    const grouped = this.groupByDomain(results);
    const sections: string[] = [];

    // Sort domains by number of results (most first)
    const sortedDomains = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [domain, domainResults] of sortedDomains) {
      const header = `## ${domain}`;
      const entries = domainResults
        .map((r) => this.formatResult(r))
        .join('\n\n');

      sections.push(`${header}\n\n${entries}`);
    }

    return sections.join('\n\n---\n\n');
  }

  private generateBodyByCategory(results: CategorizedResult[]): string {
    const grouped = new Map<string, CategorizedResult[]>();

    for (const result of results) {
      const primaryCategory = result.categories[0] ?? 'General';
      if (!grouped.has(primaryCategory)) {
        grouped.set(primaryCategory, []);
      }
      grouped.get(primaryCategory)!.push(result);
    }

    const sections: string[] = [];

    // Sort categories alphabetically
    const sortedCategories = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [category, categoryResults] of sortedCategories) {
      const header = `## ${category}`;
      const entries = categoryResults
        .map((r) => this.formatResult(r))
        .join('\n\n');

      sections.push(`${header}\n\n${entries}`);
    }

    return sections.join('\n\n---\n\n');
  }

  private generateFlatBody(results: ScoredResult[]): string {
    return results.map((r) => this.formatResult(r)).join('\n\n---\n\n');
  }

  private formatResult(result: ScoredResult | CategorizedResult): string {
    const snippet = this.truncateSnippet(result.snippet, 300);
    const score = (result.score * 100).toFixed(0);
    const date = result.timestamp.toLocaleDateString();

    const lines = [
      `### [${this.escapeMarkdown(result.title)}](${result.url})`,
      '',
      snippet,
      '',
      `*Score: ${score}% | Source: ${result.source} | Date: ${date}*`,
    ];

    // Add categories if present
    if (this.isCategorizedResult(result)) {
      const categories = result.categories.map((c) => `\`${c}\``).join(' ');
      lines.push(`*Categories: ${categories}*`);
    }

    return lines.join('\n');
  }

  private generateBacklinks(results: ScoredResult[]): string {
    const domains = new Set<string>();

    for (const result of results) {
      try {
        const hostname = new URL(result.url).hostname.replace('www.', '');
        // Remove TLD for cleaner backlinks
        const domainParts = hostname.split('.');
        if (domainParts.length >= 2) {
          domains.add(domainParts.slice(0, -1).join('.'));
        } else {
          domains.add(hostname);
        }
      } catch {
        // Skip invalid URLs
      }
    }

    const backlinks = [...domains]
      .sort()
      .map((d) => `- [[${d}]]`)
      .join('\n');

    return [
      '',
      '---',
      '',
      '## Related',
      '',
      backlinks,
      '',
    ].join('\n');
  }

  private groupByDomain(results: ScoredResult[]): Map<string, ScoredResult[]> {
    const grouped = new Map<string, ScoredResult[]>();

    for (const result of results) {
      let domain: string;
      try {
        domain = new URL(result.url).hostname.replace('www.', '');
      } catch {
        domain = 'Unknown';
      }

      if (!grouped.has(domain)) {
        grouped.set(domain, []);
      }
      grouped.get(domain)!.push(result);
    }

    return grouped;
  }

  private truncateSnippet(snippet: string, maxLength: number): string {
    if (snippet.length <= maxLength) {
      return snippet;
    }

    // Try to truncate at word boundary
    const truncated = snippet.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength * 0.8) {
      return truncated.slice(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  private escapeMarkdown(text: string): string {
    return text
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\|/g, '\\|');
  }

  private escapeFrontmatterValue(value: string): string {
    return value.replace(/"/g, '\\"');
  }

  private isCategorizedResults(results: ScoredResult[]): boolean {
    return results.length > 0 && 'categories' in results[0]!;
  }

  private isCategorizedResult(result: ScoredResult): result is CategorizedResult {
    return 'categories' in result;
  }
}
