import type { ScoredResult } from '../providers/types.js';
import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('categorizer');

export interface Category {
  name: string;
  description?: string;
  rules: CategoryRule[];
}

export interface CategoryRule {
  type: 'domain' | 'keyword' | 'url_pattern';
  value: string | string[];
  weight?: number;
}

export interface CategorizedResult extends ScoredResult {
  categories: string[];
}

const DEFAULT_CATEGORIES: Category[] = [
  {
    name: 'Documentation',
    description: 'Official documentation and reference materials',
    rules: [
      { type: 'domain', value: ['docs.', 'documentation.', 'developer.', 'devdocs.'] },
      { type: 'keyword', value: ['documentation', 'docs', 'api reference', 'guide'] },
      { type: 'url_pattern', value: ['/docs/', '/documentation/', '/api/', '/reference/'] },
    ],
  },
  {
    name: 'Tutorial',
    description: 'Step-by-step tutorials and how-to guides',
    rules: [
      { type: 'keyword', value: ['tutorial', 'how to', 'step by step', 'getting started', 'learn'] },
      { type: 'url_pattern', value: ['/tutorial', '/guide/', '/learn/', '/howto/'] },
    ],
  },
  {
    name: 'Repository',
    description: 'Source code repositories and packages',
    rules: [
      { type: 'domain', value: ['github.com', 'gitlab.com', 'bitbucket.org', 'npmjs.com', 'pypi.org'] },
      { type: 'url_pattern', value: ['/repository/', '/packages/', '/releases/'] },
    ],
  },
  {
    name: 'Discussion',
    description: 'Community discussions and Q&A',
    rules: [
      { type: 'domain', value: ['stackoverflow.com', 'reddit.com', 'discourse.', 'discuss.'] },
      { type: 'keyword', value: ['question', 'answer', 'discussion', 'forum', 'community'] },
    ],
  },
  {
    name: 'Blog',
    description: 'Blog posts and articles',
    rules: [
      { type: 'domain', value: ['medium.com', 'dev.to', 'hashnode.', 'substack.com'] },
      { type: 'url_pattern', value: ['/blog/', '/posts/', '/articles/', '/news/'] },
      { type: 'keyword', value: ['blog post', 'article', 'written by'] },
    ],
  },
  {
    name: 'News',
    description: 'News articles and announcements',
    rules: [
      { type: 'keyword', value: ['announced', 'release', 'update', 'breaking', 'news'] },
      { type: 'url_pattern', value: ['/news/', '/announcements/', '/press/'] },
    ],
  },
  {
    name: 'Video',
    description: 'Video content',
    rules: [
      { type: 'domain', value: ['youtube.com', 'vimeo.com', 'twitch.tv'] },
      { type: 'url_pattern', value: ['/watch', '/video/', '/videos/'] },
    ],
  },
  {
    name: 'Research',
    description: 'Academic and research papers',
    rules: [
      { type: 'domain', value: ['arxiv.org', 'scholar.google', 'researchgate.net', 'academia.edu'] },
      { type: 'keyword', value: ['paper', 'research', 'study', 'abstract', 'citation'] },
      { type: 'url_pattern', value: ['/paper/', '/publication/', '/research/'] },
    ],
  },
];

export class Categorizer {
  private categories: Category[];

  constructor(customCategories?: Category[]) {
    this.categories = customCategories ?? DEFAULT_CATEGORIES;
  }

  categorize(results: ScoredResult[]): CategorizedResult[] {
    const categorized = results.map((result) => ({
      ...result,
      categories: this.matchCategories(result),
    }));

    logger.debug({ count: categorized.length }, 'Categorization complete');
    return categorized;
  }

  private matchCategories(result: ScoredResult): string[] {
    const matches: string[] = [];
    const url = result.url.toLowerCase();
    const text = `${result.title} ${result.snippet}`.toLowerCase();

    let hostname: string;
    try {
      hostname = new URL(result.url).hostname.toLowerCase();
    } catch {
      hostname = '';
    }

    for (const category of this.categories) {
      let matched = false;

      for (const rule of category.rules) {
        if (matched) break;

        const values = Array.isArray(rule.value) ? rule.value : [rule.value];

        switch (rule.type) {
          case 'domain':
            for (const domain of values) {
              if (hostname.includes(domain.toLowerCase())) {
                matched = true;
                break;
              }
            }
            break;

          case 'keyword':
            for (const keyword of values) {
              if (text.includes(keyword.toLowerCase())) {
                matched = true;
                break;
              }
            }
            break;

          case 'url_pattern':
            for (const pattern of values) {
              if (url.includes(pattern.toLowerCase())) {
                matched = true;
                break;
              }
            }
            break;
        }
      }

      if (matched) {
        matches.push(category.name);
      }
    }

    // Default category if none matched
    if (matches.length === 0) {
      matches.push('General');
    }

    return matches;
  }

  addCategory(category: Category): void {
    this.categories.push(category);
  }

  removeCategory(name: string): void {
    const index = this.categories.findIndex((c) => c.name === name);
    if (index > -1) {
      this.categories.splice(index, 1);
    }
  }

  getCategories(): Category[] {
    return [...this.categories];
  }

  groupByCategory(results: CategorizedResult[]): Map<string, CategorizedResult[]> {
    const grouped = new Map<string, CategorizedResult[]>();

    for (const result of results) {
      for (const category of result.categories) {
        if (!grouped.has(category)) {
          grouped.set(category, []);
        }
        grouped.get(category)!.push(result);
      }
    }

    return grouped;
  }
}
