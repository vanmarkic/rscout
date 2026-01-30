# rscout - Resource Scout

A lightweight, no-AI web resource finder and aggregator CLI tool. Query multiple search APIs, aggregate results, deduplicate, and output clean Markdown files compatible with Obsidian.

## Features

- **Multiple Search Providers**: DuckDuckGo (no API key), Brave Search, SerpAPI, and RSS feeds
- **Interactive Search**: Progressive refinement with user input in the loop
- **Query Refinement**: Automatic term extraction and suggestion generation
- **Smart Deduplication**: URL normalization and content fingerprinting
- **Advanced Scoring**: BM25 + TF-IDF hybrid scoring with recency and domain authority
- **Local Semantic Search**: all-MiniLM-L6-v2 embeddings (FREE, runs locally, no API)
- **Content Extraction**: Jina Reader integration for clean markdown from any URL
- **Cloudflare Bypass**: FlareSolverr support for protected sites
- **AST-Aware Chunking**: tree-sitter based code chunking that preserves structure
- **Obsidian Integration**: YAML frontmatter, backlinks, and customizable tags
- **Caching**: File-based result cache to reduce API calls
- **Rate Limiting**: Per-provider rate limiting to respect API limits

## Installation

```bash
# Clone the repository
git clone https://github.com/your-username/rscout.git
cd rscout

# Install dependencies
pnpm install

# Build the project
pnpm build

# Link globally (optional)
pnpm link --global
```

## Quick Start

```bash
# Search using DuckDuckGo (no API key required)
pnpm rscout search "TypeScript design patterns" --limit 20

# Output to a file
pnpm rscout search "Belgian cohousing regulations" --output ./research/cohousing.md

# Interactive search with progressive refinement
pnpm rscout interactive "machine learning frameworks"

# Get refinement suggestions for a query
pnpm rscout refine "react state management"

# Check provider status
pnpm rscout status
```

## Configuration

Create a configuration file at `config/local.yaml` or `rscout.yaml`:

```yaml
providers:
  brave:
    enabled: true
    apiKey: ${BRAVE_API_KEY}  # Set via environment variable
    rateLimit: 1

  duckduckgo:
    enabled: true
    rateLimit: 0.5

  rss:
    enabled: true
    feeds:
      - https://example.com/feed.xml
      - https://blog.example.com/rss

search:
  defaultLimit: 20
  timeout: 10000

scoring:
  weights:
    recency: 0.3
    domainAuthority: 0.2
    keywordRelevance: 0.5
  trustedDomains:
    - wikipedia.org
    - github.com

output:
  format: markdown
  obsidian:
    tags:
      - rscout
      - research
    frontmatter: true
```

## CLI Commands

### Search

```bash
rscout search <query> [options]

Options:
  -l, --limit <number>           Maximum results (default: 20)
  -p, --providers <list>         Comma-separated providers: brave,duckduckgo,rss,serp
  -d, --domains <list>           Include only these domains
  -x, --exclude-domains <list>   Exclude these domains
  -s, --since <date>             Results since date (YYYY-MM-DD)
  -u, --until <date>             Results until date (YYYY-MM-DD)
  -o, --output <path>            Output file path
  -f, --format <type>            Output format: markdown or json
  -c, --config <path>            Config file path
  --no-cache                     Disable caching
  --group-by <type>              Group by: domain, category, or none
```

### RSS Feeds

```bash
rscout feeds [options]

Options:
  -q, --query <query>    Filter feed items
  -l, --limit <number>   Maximum results
  -o, --output <path>    Output file path
  -f, --format <type>    Output format
```

### Interactive Search

Progressive search refinement with user input in the loop:

```bash
rscout interactive <query> [options]
rscout i <query>  # alias

Options:
  -d, --depth <number>   Maximum refinement depth (default: 3)
  -l, --limit <number>   Results per search round (default: 10)
  -f, --format <type>    Output format: markdown or json
  -o, --output <path>    Output file for final export
  -c, --config <path>    Config file path
```

**Interactive Commands:**
- `[number]` - Select a suggestion by number
- `[numbers]` - Select multiple (e.g., "1,3,5" or "1-3")
- `/add <term>` - Add custom search term
- `/query <q>` - Start fresh with new query
- `/expand` - Expand search with selected terms (OR-like)
- `/narrow` - Narrow search with selected terms (AND-like)
- `/pivot` - Pivot to new direction using selected terms
- `/results` - Show current aggregated results
- `/export` - Export results and exit
- `/done` - Finish and return results
- `/quit` - Exit without saving

### Refine (Single Round)

Get refinement suggestions without entering interactive mode:

```bash
rscout refine <query> [options]

Options:
  -l, --limit <number>       Results to analyze (default: 20)
  -s, --suggestions <number> Number of suggestions (default: 10)
  -c, --config <path>        Config file path
  --json                     Output as JSON
```

Example output:
```
Suggested refinements:

   1. framework                 ████████░░ (title)
   2. patterns                  ███████░░░ (combined)
   3. design patterns           ██████░░░░ (combined)

Example refined queries:

  Expand (broaden search):
    rscout search "typescript framework"
    rscout search "typescript patterns"

  Narrow (focus search):
    rscout search "\"typescript\" \"framework\""

  Pivot (new direction):
    rscout search "framework"
```

### Cache Management

```bash
rscout cache clear   # Clear all cached results
rscout cache prune   # Remove expired entries
rscout cache stats   # Show cache statistics
```

### Provider Status

```bash
rscout status        # Check health of all providers
```

## Output Formats

### Markdown (Obsidian)

The default output format includes:
- YAML frontmatter with metadata
- Results grouped by domain or category
- Relevance scores
- Obsidian backlinks to source domains

```markdown
---
title: "TypeScript patterns"
date: 2024-01-15
tags: ["rscout", "research"]
sources: ["duckduckgo", "brave"]
total_results: 15
---

# TypeScript patterns

## github.com

### [TypeScript Handbook](https://github.com/microsoft/TypeScript)

Official TypeScript documentation and examples...

*Score: 95% | Source: brave | Date: 1/15/2024*

---

## Related

- [[github]]
- [[stackoverflow]]
```

### JSON

```json
{
  "meta": {
    "query": "TypeScript patterns",
    "timestamp": "2024-01-15T10:30:00Z",
    "providers": ["duckduckgo", "brave"],
    "totalResults": 15
  },
  "results": [
    {
      "url": "https://github.com/microsoft/TypeScript",
      "title": "TypeScript Handbook",
      "snippet": "...",
      "score": 0.95,
      "categories": ["Repository"]
    }
  ]
}
```

## API Keys

### Brave Search

1. Sign up at [Brave Search API](https://brave.com/search/api/)
2. Get your API key
3. Set environment variable: `export BRAVE_API_KEY=your-key`

### SerpAPI (Optional)

1. Sign up at [SerpAPI](https://serpapi.com/)
2. Get your API key
3. Set environment variable: `export SERP_API_KEY=your-key`

## Development

```bash
# Run in development mode
pnpm dev search "test query"

# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Type checking
pnpm lint

# Build
pnpm build
```

## Architecture

```
rscout/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── config/               # Configuration schema and loader
│   ├── providers/            # Search provider implementations
│   ├── pipeline/             # Processing pipeline
│   ├── output/               # Output generators
│   └── utils/                # Utilities (cache, logger, rate-limiter)
├── config/                   # Default configuration
└── templates/                # Output templates
```

### Pipeline Flow

1. **Fetch**: Query enabled providers in parallel
2. **Deduplicate**: Remove duplicate URLs and similar content
3. **Score**: Calculate relevance scores
4. **Categorize**: Apply rule-based categorization
5. **Output**: Generate Markdown or JSON

## License

MIT
