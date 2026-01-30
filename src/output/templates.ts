import type { ScoredResult } from '../providers/types.js';
import type { CategorizedResult } from '../pipeline/categorizer.js';

export interface TemplateContext {
  query: string;
  date: string;
  timestamp: string;
  providers: string[];
  totalResults: number;
  results: TemplateResult[];
  groupedByDomain: Map<string, TemplateResult[]>;
  groupedByCategory: Map<string, TemplateResult[]>;
  tags: string[];
}

export interface TemplateResult {
  url: string;
  title: string;
  snippet: string;
  source: string;
  timestamp: string;
  score: number;
  scorePercent: number;
  domain: string;
  categories: string[];
}

export function createTemplateContext(
  results: ScoredResult[] | CategorizedResult[],
  options: {
    query: string;
    providers: string[];
    tags?: string[];
  }
): TemplateContext {
  const now = new Date();

  const templateResults: TemplateResult[] = results.map((r) => {
    let domain: string;
    try {
      domain = new URL(r.url).hostname.replace('www.', '');
    } catch {
      domain = 'unknown';
    }

    return {
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      source: r.source,
      timestamp: r.timestamp.toISOString(),
      score: r.score,
      scorePercent: Math.round(r.score * 100),
      domain,
      categories: 'categories' in r ? r.categories : [],
    };
  });

  // Group by domain
  const groupedByDomain = new Map<string, TemplateResult[]>();
  for (const result of templateResults) {
    if (!groupedByDomain.has(result.domain)) {
      groupedByDomain.set(result.domain, []);
    }
    groupedByDomain.get(result.domain)!.push(result);
  }

  // Group by category
  const groupedByCategory = new Map<string, TemplateResult[]>();
  for (const result of templateResults) {
    for (const category of result.categories) {
      if (!groupedByCategory.has(category)) {
        groupedByCategory.set(category, []);
      }
      groupedByCategory.get(category)!.push(result);
    }
  }

  return {
    query: options.query,
    date: now.toISOString().split('T')[0] ?? '',
    timestamp: now.toISOString(),
    providers: options.providers,
    totalResults: results.length,
    results: templateResults,
    groupedByDomain,
    groupedByCategory,
    tags: options.tags ?? [],
  };
}

// Simple template engine - replace {{variable}} patterns
export function renderTemplate(template: string, context: TemplateContext): string {
  let output = template;

  // Replace simple variables
  output = output.replace(/\{\{query\}\}/g, context.query);
  output = output.replace(/\{\{date\}\}/g, context.date);
  output = output.replace(/\{\{timestamp\}\}/g, context.timestamp);
  output = output.replace(/\{\{totalResults\}\}/g, String(context.totalResults));
  output = output.replace(/\{\{providers\}\}/g, context.providers.join(', '));
  output = output.replace(/\{\{tags\}\}/g, context.tags.map((t) => `#${t}`).join(' '));

  // Handle each blocks for results
  const eachResultsPattern = /\{\{#each results\}\}([\s\S]*?)\{\{\/each\}\}/g;
  output = output.replace(eachResultsPattern, (_, block: string) => {
    return context.results.map((result) => {
      let rendered = block;
      rendered = rendered.replace(/\{\{url\}\}/g, result.url);
      rendered = rendered.replace(/\{\{title\}\}/g, result.title);
      rendered = rendered.replace(/\{\{snippet\}\}/g, result.snippet);
      rendered = rendered.replace(/\{\{source\}\}/g, result.source);
      rendered = rendered.replace(/\{\{score\}\}/g, String(result.scorePercent));
      rendered = rendered.replace(/\{\{domain\}\}/g, result.domain);
      rendered = rendered.replace(/\{\{categories\}\}/g, result.categories.join(', '));
      return rendered;
    }).join('');
  });

  return output;
}
