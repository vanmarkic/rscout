// rscout Web - Browser-based resource aggregator
// All processing happens locally in the browser

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  source: string;
  timestamp: Date;
  score?: number;
  bm25Score?: number;
  similarity?: number;
}

// ============================================
// BM25 Scoring (Pure JS, runs in browser)
// ============================================

class BM25Ranker {
  private k1 = 1.5;
  private b = 0.75;
  private avgDocLength = 0;
  private totalDocs = 0;
  private idfCache = new Map<string, number>();
  private docFrequency = new Map<string, number>();

  buildIndex(results: SearchResult[]): void {
    this.totalDocs = results.length;
    this.docFrequency.clear();
    this.idfCache.clear();

    let totalLength = 0;

    for (const result of results) {
      const text = `${result.title} ${result.title} ${result.snippet}`.toLowerCase();
      const tokens = this.tokenize(text);
      const uniqueTokens = new Set(tokens);

      totalLength += tokens.length;

      for (const token of uniqueTokens) {
        this.docFrequency.set(token, (this.docFrequency.get(token) ?? 0) + 1);
      }
    }

    this.avgDocLength = totalLength / Math.max(this.totalDocs, 1);

    for (const [term, df] of this.docFrequency) {
      this.idfCache.set(term, Math.log(1 + (this.totalDocs - df + 0.5) / (df + 0.5)));
    }
  }

  scoreAll(results: SearchResult[], query: string): SearchResult[] {
    if (this.totalDocs !== results.length) {
      this.buildIndex(results);
    }

    const queryTokens = this.tokenize(query.toLowerCase());

    return results.map((result) => ({
      ...result,
      bm25Score: this.scoreDocument(result, queryTokens),
    })).sort((a, b) => (b.bm25Score ?? 0) - (a.bm25Score ?? 0));
  }

  private scoreDocument(result: SearchResult, queryTokens: string[]): number {
    const text = `${result.title} ${result.title} ${result.snippet}`.toLowerCase();
    const docTokens = this.tokenize(text);
    const docLength = docTokens.length;

    const termFrequency = new Map<string, number>();
    for (const token of docTokens) {
      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }

    let score = 0;

    for (const queryTerm of queryTokens) {
      const tf = termFrequency.get(queryTerm) ?? 0;
      if (tf === 0) continue;

      const idf = this.idfCache.get(queryTerm) ?? 0;
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));

      score += idf * (numerator / denominator);
    }

    return score;
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
  }
}

// ============================================
// TF-IDF Scoring (Pure JS)
// ============================================

function tfidfScore(result: SearchResult, query: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const text = `${result.title} ${result.snippet}`.toLowerCase();

  let matches = 0;
  for (const term of queryTerms) {
    if (text.includes(term)) matches++;
  }

  return matches / Math.max(queryTerms.length, 1);
}

// ============================================
// Local Embeddings (Transformers.js)
// ============================================

let embeddingPipeline: any = null;
let isLoadingModel = false;

async function loadEmbeddingModel(statusCallback: (msg: string) => void): Promise<void> {
  if (embeddingPipeline || isLoadingModel) return;

  isLoadingModel = true;
  statusCallback('Loading AI model (all-MiniLM-L6-v2, ~23MB)...');

  try {
    const { pipeline } = await import('@xenova/transformers');
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
    statusCallback('AI model loaded successfully');
  } catch (error) {
    console.error('Failed to load embedding model:', error);
    statusCallback('Failed to load AI model - falling back to BM25');
    throw error;
  } finally {
    isLoadingModel = false;
  }
}

async function embed(text: string): Promise<number[]> {
  if (!embeddingPipeline) throw new Error('Model not loaded');

  const output = await embeddingPipeline(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function semanticScore(
  results: SearchResult[],
  query: string,
  statusCallback: (msg: string) => void
): Promise<SearchResult[]> {
  await loadEmbeddingModel(statusCallback);

  statusCallback('Computing embeddings...');
  const queryEmbedding = await embed(query);

  const scored: SearchResult[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    statusCallback(`Embedding ${i + 1}/${results.length}...`);

    const docEmbedding = await embed(`${result.title} ${result.snippet}`);
    const similarity = cosineSimilarity(queryEmbedding, docEmbedding);

    scored.push({ ...result, similarity, score: similarity });
  }

  return scored.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
}

// ============================================
// Search APIs (Multiple sources for reliability)
// ============================================

// SearXNG public instances with JSON API
const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://searx.tiekoetter.com',
  'https://search.ononoki.org',
];

// CORS proxies for fallback
const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy?quest=',
];

async function fetchWithCORS(url: string, options: RequestInit = {}): Promise<Response> {
  // Try direct fetch first
  try {
    const response = await fetch(url, { ...options, mode: 'cors' });
    if (response.ok) return response;
  } catch (e) {
    console.log('Direct fetch failed, trying proxies...', e);
  }

  // Try CORS proxies
  for (const proxy of CORS_PROXIES) {
    try {
      const proxyUrl = proxy + encodeURIComponent(url);
      const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) return response;
    } catch (e) {
      console.log(`Proxy ${proxy} failed`, e);
      continue;
    }
  }

  throw new Error('All fetch attempts failed');
}

// Search using SearXNG (metasearch engine with JSON API)
async function searchSearXNG(query: string, limit: number): Promise<SearchResult[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
      const response = await fetchWithCORS(url);
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        return data.results.slice(0, limit).map((r: any) => ({
          url: r.url,
          title: r.title || 'Untitled',
          snippet: r.content || r.snippet || '',
          source: 'searxng',
          timestamp: new Date(),
        }));
      }
    } catch (e) {
      console.log(`SearXNG instance ${instance} failed`, e);
      continue;
    }
  }

  return [];
}

// Search using DuckDuckGo HTML (scraping approach)
async function searchDuckDuckGoHTML(query: string, limit: number): Promise<SearchResult[]> {
  try {
    // DuckDuckGo lite version is simpler to parse
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const response = await fetchWithCORS(url);
    const html = await response.text();

    const results: SearchResult[] = [];

    // Parse the lite HTML - results are in table rows
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Find result links (they have class "result-link" in lite version)
    const links = doc.querySelectorAll('a.result-link');
    const snippets = doc.querySelectorAll('td.result-snippet');

    links.forEach((link, i) => {
      if (results.length >= limit) return;

      const href = link.getAttribute('href');
      const title = link.textContent?.trim();

      if (href && title && !href.startsWith('/')) {
        results.push({
          url: href,
          title,
          snippet: snippets[i]?.textContent?.trim() || '',
          source: 'duckduckgo',
          timestamp: new Date(),
        });
      }
    });

    return results;
  } catch (e) {
    console.log('DuckDuckGo HTML search failed', e);
    return [];
  }
}

// Search using DuckDuckGo Instant Answer API (for instant answers)
async function searchDuckDuckGoAPI(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  try {
    const response = await fetchWithCORS(url);
    const data = await response.json();

    const results: SearchResult[] = [];

    // Main abstract
    if (data.AbstractURL && data.AbstractText) {
      results.push({
        url: data.AbstractURL,
        title: data.Heading || 'Wikipedia',
        snippet: data.AbstractText,
        source: 'duckduckgo',
        timestamp: new Date(),
      });
    }

    // Related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= limit) break;

        if (topic.FirstURL && topic.Text) {
          const titleMatch = topic.Text.match(/^(.+?)\s*[-–—]\s*/);
          results.push({
            url: topic.FirstURL,
            title: titleMatch ? titleMatch[1] : topic.Text.slice(0, 60),
            snippet: topic.Text,
            source: 'duckduckgo',
            timestamp: new Date(),
          });
        }

        // Handle nested topics
        if (topic.Topics) {
          for (const subtopic of topic.Topics) {
            if (results.length >= limit) break;
            if (subtopic.FirstURL && subtopic.Text) {
              results.push({
                url: subtopic.FirstURL,
                title: subtopic.Text.slice(0, 60),
                snippet: subtopic.Text,
                source: 'duckduckgo',
                timestamp: new Date(),
              });
            }
          }
        }
      }
    }

    // Results (direct answers)
    if (data.Results) {
      for (const result of data.Results) {
        if (results.length >= limit) break;
        if (result.FirstURL && result.Text) {
          results.push({
            url: result.FirstURL,
            title: result.Text.slice(0, 60),
            snippet: result.Text,
            source: 'duckduckgo',
            timestamp: new Date(),
          });
        }
      }
    }

    return results.slice(0, limit);
  } catch (e) {
    console.log('DuckDuckGo API failed', e);
    return [];
  }
}

// ============================================
// Additional CORS-Friendly APIs (No proxy needed!)
// ============================================

// Wikipedia API - Always works, unlimited, CORS-friendly
async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${limit}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.query?.search) {
      return data.query.search.map((r: any) => ({
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
        title: r.title,
        snippet: r.snippet.replace(/<[^>]*>/g, ''), // Strip HTML
        source: 'wikipedia',
        timestamp: new Date(),
      }));
    }
  } catch (e) {
    console.log('Wikipedia search failed', e);
  }
  return [];
}

// Hacker News (Algolia) - Great for tech, CORS-friendly
async function searchHackerNews(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${limit}&tags=story`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.hits) {
      return data.hits
        .filter((r: any) => r.url) // Only items with URLs
        .map((r: any) => ({
          url: r.url || `https://news.ycombinator.com/item?id=${r.objectID}`,
          title: r.title || 'Untitled',
          snippet: `${r.points || 0} points | ${r.num_comments || 0} comments | ${r.author || 'unknown'}`,
          source: 'hackernews',
          timestamp: new Date(r.created_at || Date.now()),
        }));
    }
  } catch (e) {
    console.log('Hacker News search failed', e);
  }
  return [];
}

// GitHub Search - Great for code/repos, CORS-friendly (rate limited: 10/min unauthenticated)
async function searchGitHub(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}&sort=stars`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    const data = await response.json();

    if (data.items) {
      return data.items.map((r: any) => ({
        url: r.html_url,
        title: `${r.full_name} ⭐${r.stargazers_count}`,
        snippet: r.description || 'No description',
        source: 'github',
        timestamp: new Date(r.updated_at || Date.now()),
      }));
    }
  } catch (e) {
    console.log('GitHub search failed', e);
  }
  return [];
}

// StackExchange API - Great for Q&A, CORS-friendly
async function searchStackOverflow(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${limit}&filter=!nNPvSNdWme`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.items) {
      return data.items.map((r: any) => ({
        url: r.link,
        title: decodeHtmlEntities(r.title),
        snippet: `Score: ${r.score} | Answers: ${r.answer_count} | Views: ${r.view_count}`,
        source: 'stackoverflow',
        timestamp: new Date(r.creation_date * 1000),
      }));
    }
  } catch (e) {
    console.log('StackOverflow search failed', e);
  }
  return [];
}

// Reddit JSON - Add .json to any reddit search URL
async function searchReddit(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${limit}&sort=relevance`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.data?.children) {
      return data.data.children
        .filter((r: any) => r.data)
        .map((r: any) => ({
          url: `https://reddit.com${r.data.permalink}`,
          title: r.data.title,
          snippet: `r/${r.data.subreddit} | ⬆${r.data.ups} | ${r.data.num_comments} comments`,
          source: 'reddit',
          timestamp: new Date(r.data.created_utc * 1000),
        }));
    }
  } catch (e) {
    console.log('Reddit search failed', e);
  }
  return [];
}

// arXiv API - Academic papers, CORS-friendly
async function searchArxiv(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
    const response = await fetch(url);
    const xml = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'text/xml');
    const entries = doc.querySelectorAll('entry');

    const results: SearchResult[] = [];
    entries.forEach((entry) => {
      const title = entry.querySelector('title')?.textContent?.trim() || '';
      const summary = entry.querySelector('summary')?.textContent?.trim() || '';
      const link = entry.querySelector('id')?.textContent || '';
      const published = entry.querySelector('published')?.textContent || '';

      if (title && link) {
        results.push({
          url: link,
          title,
          snippet: summary.slice(0, 200) + (summary.length > 200 ? '...' : ''),
          source: 'arxiv',
          timestamp: new Date(published),
        });
      }
    });

    return results;
  } catch (e) {
    console.log('arXiv search failed', e);
  }
  return [];
}

// Helper to decode HTML entities
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

// Main search function - tries multiple sources
async function search(query: string, limit: number, statusCallback: (msg: string) => void): Promise<SearchResult[]> {
  const allResults: SearchResult[] = [];

  // Try SearXNG first (best general results)
  statusCallback('Searching SearXNG...');
  let results = await searchSearXNG(query, limit);
  if (results.length > 0) {
    allResults.push(...results);
  }

  // If SearXNG failed, try DuckDuckGo
  if (allResults.length === 0) {
    statusCallback('Trying DuckDuckGo...');
    results = await searchDuckDuckGoHTML(query, limit);
    allResults.push(...results);
  }

  if (allResults.length === 0) {
    statusCallback('Trying DuckDuckGo API...');
    results = await searchDuckDuckGoAPI(query, limit);
    allResults.push(...results);
  }

  // Always add results from CORS-friendly APIs in parallel
  statusCallback('Searching Wikipedia, HN, GitHub...');
  const [wikiResults, hnResults, ghResults, soResults, redditResults] = await Promise.all([
    searchWikipedia(query, Math.min(limit, 5)),
    searchHackerNews(query, Math.min(limit, 5)),
    searchGitHub(query, Math.min(limit, 5)),
    searchStackOverflow(query, Math.min(limit, 5)),
    searchReddit(query, Math.min(limit, 5)),
  ]);

  allResults.push(...wikiResults, ...hnResults, ...ghResults, ...soResults, ...redditResults);

  if (allResults.length === 0) {
    statusCallback('No results from any source');
  }

  return allResults;
}

// ============================================
// Query Refinement
// ============================================

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'this', 'but', 'they', 'have',
]);

function extractSuggestions(results: SearchResult[], originalQuery: string): string[] {
  const queryTerms = new Set(originalQuery.toLowerCase().split(/\s+/));
  const termFrequency = new Map<string, number>();

  for (const result of results) {
    const text = `${result.title} ${result.snippet}`.toLowerCase();
    const tokens = text.replace(/[^\w\s]/g, ' ').split(/\s+/);

    for (const token of tokens) {
      if (token.length < 3) continue;
      if (STOP_WORDS.has(token)) continue;
      if (queryTerms.has(token)) continue;

      termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
    }
  }

  return [...termFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term);
}

// ============================================
// UI Logic
// ============================================

const queryInput = document.getElementById('query') as HTMLInputElement;
const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
const limitSelect = document.getElementById('limit') as HTMLSelectElement;
const scoringSelect = document.getElementById('scoring') as HTMLSelectElement;
const useEmbeddingsCheckbox = document.getElementById('use-embeddings') as HTMLInputElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;
const resultsDiv = document.getElementById('results') as HTMLDivElement;
const suggestionsDiv = document.getElementById('suggestions') as HTMLDivElement;
const suggestionChipsDiv = document.getElementById('suggestion-chips') as HTMLDivElement;

const bm25 = new BM25Ranker();

function setStatus(message: string, type: 'ready' | 'loading' | 'error' = 'ready'): void {
  statusDiv.className = `status ${type}`;

  if (type === 'loading') {
    statusDiv.innerHTML = `<div class="spinner"></div> ${message}`;
  } else if (type === 'error') {
    statusDiv.innerHTML = `<span>✗</span> ${message}`;
  } else {
    statusDiv.innerHTML = `<span>✓</span> ${message}`;
  }
}

function renderResults(results: SearchResult[]): void {
  if (results.length === 0) {
    resultsDiv.innerHTML = `
      <div class="empty-state">
        <p>No results found</p>
        <p style="margin-top: 0.5rem; font-size: 0.85rem;">Try a different search term or check your connection</p>
      </div>
    `;
    return;
  }

  const maxScore = Math.max(...results.map((r) => r.score ?? r.bm25Score ?? r.similarity ?? 0), 0.01);

  resultsDiv.innerHTML = results.map((result) => {
    const score = result.score ?? result.bm25Score ?? result.similarity ?? 0;
    const normalizedScore = (score / maxScore) * 100;

    let domain = 'unknown';
    try {
      domain = new URL(result.url).hostname.replace('www.', '');
    } catch {}

    return `
      <div class="result-card">
        <div class="result-title">
          <a href="${result.url}" target="_blank" rel="noopener">${result.title || 'Untitled'}</a>
        </div>
        <div class="result-snippet">${result.snippet.slice(0, 200)}${result.snippet.length > 200 ? '...' : ''}</div>
        <div class="result-meta">
          <span>
            <div class="score-bar"><div class="score-fill" style="width: ${normalizedScore}%"></div></div>
            ${normalizedScore.toFixed(0)}%
          </span>
          <span>${domain}</span>
          <span>${result.source}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderSuggestions(suggestions: string[], query: string): void {
  if (suggestions.length === 0) {
    suggestionsDiv.style.display = 'none';
    return;
  }

  suggestionsDiv.style.display = 'block';
  suggestionChipsDiv.innerHTML = suggestions.map((term) => `
    <span class="chip" data-term="${term}">${term}</span>
  `).join('');

  suggestionChipsDiv.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const term = (chip as HTMLElement).dataset.term;
      queryInput.value = `${query} ${term}`;
      performSearch();
    });
  });
}

async function performSearch(): Promise<void> {
  const query = queryInput.value.trim();
  if (!query) return;

  const limit = parseInt(limitSelect.value, 10);
  const scoring = scoringSelect.value;
  const useSemanticEmbeddings = useEmbeddingsCheckbox.checked || scoring === 'semantic';

  searchBtn.disabled = true;
  setStatus('Searching...', 'loading');

  try {
    // Fetch results from multiple sources
    let results = await search(query, limit * 2, setStatus);

    if (results.length === 0) {
      setStatus('No results found', 'error');
      renderResults([]);
      suggestionsDiv.style.display = 'none';
      return;
    }

    setStatus(`Found ${results.length} results, scoring...`, 'loading');

    // Score results
    if (useSemanticEmbeddings || scoring === 'semantic') {
      results = await semanticScore(results, query, setStatus);
    } else if (scoring === 'bm25') {
      results = bm25.scoreAll(results, query);
      results = results.map((r) => ({ ...r, score: r.bm25Score }));
    } else {
      results = results.map((r) => ({ ...r, score: tfidfScore(r, query) }));
      results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }

    // Limit and deduplicate
    const seenUrls = new Set<string>();
    results = results.filter((r) => {
      if (seenUrls.has(r.url)) return false;
      seenUrls.add(r.url);
      return true;
    }).slice(0, limit);

    // Extract suggestions
    const suggestions = extractSuggestions(results, query);

    setStatus(`${results.length} results ranked with ${scoring.toUpperCase()}`, 'ready');
    renderResults(results);
    renderSuggestions(suggestions, query);
  } catch (error) {
    console.error('Search error:', error);
    setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
  } finally {
    searchBtn.disabled = false;
  }
}

// Event listeners
searchBtn.addEventListener('click', performSearch);
queryInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') performSearch();
});

useEmbeddingsCheckbox.addEventListener('change', () => {
  if (useEmbeddingsCheckbox.checked && !embeddingPipeline && !isLoadingModel) {
    loadEmbeddingModel(setStatus).catch(() => {
      useEmbeddingsCheckbox.checked = false;
    });
  }
});

scoringSelect.addEventListener('change', () => {
  if (scoringSelect.value === 'semantic' && !embeddingPipeline && !isLoadingModel) {
    loadEmbeddingModel(setStatus).catch(() => {
      scoringSelect.value = 'bm25';
    });
  }
});

// Initial state
setStatus('Ready to search', 'ready');
