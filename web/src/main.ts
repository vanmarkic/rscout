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
    // Dynamic import of Transformers.js
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
// Search via CORS Proxy
// ============================================

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://corsproxy.io/?',
];

async function fetchWithCORS(url: string): Promise<Response> {
  // Try direct fetch first (might work for some APIs)
  try {
    const response = await fetch(url);
    if (response.ok) return response;
  } catch {
    // Continue to try proxies
  }

  // Try CORS proxies
  for (const proxy of CORS_PROXIES) {
    try {
      const response = await fetch(proxy + encodeURIComponent(url));
      if (response.ok) return response;
    } catch {
      continue;
    }
  }

  throw new Error('All CORS proxies failed');
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  try {
    const response = await fetchWithCORS(url);
    const data = await response.json();

    const results: SearchResult[] = [];

    // Main abstract
    if (data.AbstractURL && data.AbstractText) {
      results.push({
        url: data.AbstractURL,
        title: data.Heading || 'DuckDuckGo Result',
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
      }
    }

    return results.slice(0, limit);
  } catch (error) {
    console.error('DuckDuckGo search failed:', error);
    return [];
  }
}

// Alternative: Use Jina Reader for content extraction (has CORS support)
async function fetchWithJina(url: string): Promise<{ title: string; content: string } | null> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(jinaUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      title: data.data?.title || '',
      content: data.data?.content || '',
    };
  } catch {
    return null;
  }
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
        <p style="margin-top: 0.5rem; font-size: 0.85rem;">Try a different search term</p>
      </div>
    `;
    return;
  }

  const maxScore = Math.max(...results.map((r) => r.score ?? r.bm25Score ?? r.similarity ?? 0), 1);

  resultsDiv.innerHTML = results.map((result, i) => {
    const score = result.score ?? result.bm25Score ?? result.similarity ?? 0;
    const normalizedScore = (score / maxScore) * 100;
    const domain = new URL(result.url).hostname.replace('www.', '');

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

  // Add click handlers
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
    // Fetch results
    let results = await searchDuckDuckGo(query, limit * 2); // Fetch more for better ranking

    if (results.length === 0) {
      setStatus('No results found', 'ready');
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

    // Limit results
    results = results.slice(0, limit);

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

// Pre-load embedding model if checkbox is checked
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
