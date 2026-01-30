import { createChildLogger } from './logger.js';

const logger = createChildLogger('content-extractor');

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  markdown: string;
  description?: string;
  author?: string;
  publishedDate?: string;
  images?: string[];
  links?: string[];
}

export interface ExtractionOptions {
  timeout?: number;
  includeImages?: boolean;
  includeLinks?: boolean;
  maxLength?: number;
}

/**
 * Jina Reader API integration for content extraction.
 * Converts any URL to clean, LLM-friendly markdown.
 * Free tier available, no API key required for basic usage.
 *
 * Usage: Prefix any URL with r.jina.ai/ to get markdown content
 */
export class JinaReader {
  private readonly baseUrl = 'https://r.jina.ai';

  constructor(private apiKey?: string) {}

  /**
   * Extract content from a URL using Jina Reader
   */
  async extract(url: string, options: ExtractionOptions = {}): Promise<ExtractedContent> {
    const timeout = options.timeout ?? 30000;
    const jinaUrl = `${this.baseUrl}/${url}`;

    logger.debug({ url, jinaUrl }, 'Extracting content via Jina Reader');

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Return-Format': 'markdown',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      if (options.includeImages) {
        headers['X-With-Images-Summary'] = 'true';
      }

      if (options.includeLinks) {
        headers['X-With-Links-Summary'] = 'true';
      }

      const response = await fetch(jinaUrl, {
        headers,
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        throw new Error(`Jina Reader error: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');

      // Jina returns markdown directly when Accept is text/plain
      // Or JSON when Accept is application/json
      if (contentType?.includes('application/json')) {
        const data = await response.json() as {
          code: number;
          status: number;
          data: {
            title: string;
            url: string;
            content: string;
            description?: string;
            images?: Record<string, string>;
            links?: Record<string, string>;
          };
        };

        return {
          url: data.data.url || url,
          title: data.data.title || '',
          content: this.extractPlainText(data.data.content),
          markdown: data.data.content,
          description: data.data.description,
          images: data.data.images ? Object.values(data.data.images) : undefined,
          links: data.data.links ? Object.values(data.data.links) : undefined,
        };
      }

      // Plain markdown response
      const markdown = await response.text();
      const title = this.extractTitleFromMarkdown(markdown);

      return {
        url,
        title,
        content: this.extractPlainText(markdown),
        markdown,
      };
    } catch (error) {
      logger.error({ url, error }, 'Jina Reader extraction failed');
      throw error;
    }
  }

  /**
   * Batch extract content from multiple URLs
   */
  async extractBatch(
    urls: string[],
    options: ExtractionOptions = {}
  ): Promise<Map<string, ExtractedContent | Error>> {
    const results = new Map<string, ExtractedContent | Error>();

    // Process in parallel with concurrency limit
    const concurrency = 3;
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const promises = batch.map(async (url) => {
        try {
          const content = await this.extract(url, options);
          results.set(url, content);
        } catch (error) {
          results.set(url, error instanceof Error ? error : new Error(String(error)));
        }
      });

      await Promise.all(promises);
    }

    return results;
  }

  private extractTitleFromMarkdown(markdown: string): string {
    // Try to find h1 heading
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1]?.trim() ?? '';

    // Try to find title in first line
    const firstLine = markdown.split('\n')[0];
    return firstLine?.trim() ?? '';
  }

  private extractPlainText(markdown: string): string {
    return markdown
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]+`/g, '') // Remove inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links to text
      .replace(/[#*_~`]/g, '') // Remove markdown formatting
      .replace(/\n{3,}/g, '\n\n') // Normalize newlines
      .trim();
  }
}

/**
 * FlareSolverr integration for Cloudflare-protected sites.
 * Requires a running FlareSolverr instance.
 *
 * @see https://github.com/FlareSolverr/FlareSolverr
 */
export class FlareSolverr {
  constructor(
    private endpoint: string = 'http://localhost:8191/v1',
    private maxTimeout: number = 60000
  ) {}

  /**
   * Fetch content from a Cloudflare-protected URL
   */
  async fetch(url: string, options: { timeout?: number } = {}): Promise<string> {
    const timeout = options.timeout ?? this.maxTimeout;

    logger.debug({ url }, 'Fetching via FlareSolverr');

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cmd: 'request.get',
          url,
          maxTimeout: timeout,
        }),
        signal: AbortSignal.timeout(timeout + 5000),
      });

      if (!response.ok) {
        throw new Error(`FlareSolverr error: ${response.status}`);
      }

      const data = await response.json() as {
        status: string;
        message: string;
        solution: {
          url: string;
          status: number;
          response: string;
          cookies: Array<{ name: string; value: string }>;
          userAgent: string;
        };
      };

      if (data.status !== 'ok') {
        throw new Error(`FlareSolverr failed: ${data.message}`);
      }

      return data.solution.response;
    } catch (error) {
      logger.error({ url, error }, 'FlareSolverr fetch failed');
      throw error;
    }
  }

  /**
   * Check if FlareSolverr is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd: 'sessions.list' }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Unified content extractor that tries multiple methods
 */
export class ContentExtractor {
  private jinaReader: JinaReader;
  private flareSolverr?: FlareSolverr;

  constructor(options: {
    jinaApiKey?: string;
    flareSolverrEndpoint?: string;
  } = {}) {
    this.jinaReader = new JinaReader(options.jinaApiKey);

    if (options.flareSolverrEndpoint) {
      this.flareSolverr = new FlareSolverr(options.flareSolverrEndpoint);
    }
  }

  /**
   * Extract content from a URL, trying multiple methods
   */
  async extract(url: string, options: ExtractionOptions = {}): Promise<ExtractedContent> {
    try {
      // Try Jina Reader first (handles most cases)
      return await this.jinaReader.extract(url, options);
    } catch (jinaError) {
      logger.warn({ url, error: jinaError }, 'Jina Reader failed, trying fallback');

      // Try FlareSolverr if available (for Cloudflare-protected sites)
      if (this.flareSolverr) {
        try {
          const html = await this.flareSolverr.fetch(url, options);
          return this.parseHtml(url, html);
        } catch (flareError) {
          logger.warn({ url, error: flareError }, 'FlareSolverr also failed');
        }
      }

      // Fallback to basic fetch
      return await this.basicFetch(url, options);
    }
  }

  private async basicFetch(url: string, options: ExtractionOptions = {}): Promise<ExtractedContent> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.timeout ?? 10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; rscout/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    const html = await response.text();
    return this.parseHtml(url, html);
  }

  private parseHtml(url: string, html: string): ExtractedContent {
    // Basic HTML to text extraction (without full DOM parsing)
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '';
    const description = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] ?? '';

    // Remove script/style tags
    let content = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate if too long
    if (content.length > 50000) {
      content = content.slice(0, 50000) + '...';
    }

    return {
      url,
      title,
      content,
      markdown: `# ${title}\n\n${content}`,
      description,
    };
  }
}
