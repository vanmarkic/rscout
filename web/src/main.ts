// rscout Web - Browser-based resource aggregator
// All processing happens locally in the browser

// ============================================
// LZ-String Compression (for URL-safe encoding)
// Based on lz-string by pieroxy - MIT License
// ============================================

const LZString = (() => {
  const keyStrUriSafe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
  const baseReverseDic: Record<string, Record<string, number>> = {};

  function getBaseValue(alphabet: string, character: string): number {
    if (!baseReverseDic[alphabet]) {
      baseReverseDic[alphabet] = {};
      for (let i = 0; i < alphabet.length; i++) {
        baseReverseDic[alphabet][alphabet.charAt(i)] = i;
      }
    }
    return baseReverseDic[alphabet][character];
  }

  function compressToEncodedURIComponent(input: string | null): string {
    if (input == null) return '';
    return _compress(input, 6, (a) => keyStrUriSafe.charAt(a));
  }

  function decompressFromEncodedURIComponent(input: string | null): string | null {
    if (input == null) return '';
    if (input === '') return null;
    input = input.replace(/ /g, '+');
    return _decompress(input.length, 32, (index) => getBaseValue(keyStrUriSafe, input!.charAt(index)));
  }

  function _compress(uncompressed: string, bitsPerChar: number, getCharFromInt: (a: number) => string): string {
    let i: number, value: number;
    const context_dictionary: Record<string, number> = {};
    const context_dictionaryToCreate: Record<string, boolean> = {};
    let context_c = '';
    let context_wc = '';
    let context_w = '';
    let context_enlargeIn = 2;
    let context_dictSize = 3;
    let context_numBits = 2;
    let context_data: string[] = [];
    let context_data_val = 0;
    let context_data_position = 0;

    for (let ii = 0; ii < uncompressed.length; ii++) {
      context_c = uncompressed.charAt(ii);
      if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
        context_dictionary[context_c] = context_dictSize++;
        context_dictionaryToCreate[context_c] = true;
      }

      context_wc = context_w + context_c;
      if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
        context_w = context_wc;
      } else {
        if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
          if (context_w.charCodeAt(0) < 256) {
            for (i = 0; i < context_numBits; i++) {
              context_data_val = context_data_val << 1;
              if (context_data_position === bitsPerChar - 1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
            }
            value = context_w.charCodeAt(0);
            for (i = 0; i < 8; i++) {
              context_data_val = (context_data_val << 1) | (value & 1);
              if (context_data_position === bitsPerChar - 1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          } else {
            value = 1;
            for (i = 0; i < context_numBits; i++) {
              context_data_val = (context_data_val << 1) | value;
              if (context_data_position === bitsPerChar - 1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = 0;
            }
            value = context_w.charCodeAt(0);
            for (i = 0; i < 16; i++) {
              context_data_val = (context_data_val << 1) | (value & 1);
              if (context_data_position === bitsPerChar - 1) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
              } else {
                context_data_position++;
              }
              value = value >> 1;
            }
          }
          context_enlargeIn--;
          if (context_enlargeIn === 0) {
            context_enlargeIn = Math.pow(2, context_numBits);
            context_numBits++;
          }
          delete context_dictionaryToCreate[context_w];
        } else {
          value = context_dictionary[context_w];
          for (i = 0; i < context_numBits; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        context_dictionary[context_wc] = context_dictSize++;
        context_w = String(context_c);
      }
    }

    if (context_w !== '') {
      if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
        if (context_w.charCodeAt(0) < 256) {
          for (i = 0; i < context_numBits; i++) {
            context_data_val = context_data_val << 1;
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 8; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        } else {
          value = 1;
          for (i = 0; i < context_numBits; i++) {
            context_data_val = (context_data_val << 1) | value;
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = 0;
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 16; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1) {
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = value >> 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0) {
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        for (i = 0; i < context_numBits; i++) {
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === bitsPerChar - 1) {
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value = value >> 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn === 0) {
        context_numBits++;
      }
    }

    value = 2;
    for (i = 0; i < context_numBits; i++) {
      context_data_val = (context_data_val << 1) | (value & 1);
      if (context_data_position === bitsPerChar - 1) {
        context_data_position = 0;
        context_data.push(getCharFromInt(context_data_val));
        context_data_val = 0;
      } else {
        context_data_position++;
      }
      value = value >> 1;
    }

    while (true) {
      context_data_val = context_data_val << 1;
      if (context_data_position === bitsPerChar - 1) {
        context_data.push(getCharFromInt(context_data_val));
        break;
      } else context_data_position++;
    }
    return context_data.join('');
  }

  function _decompress(length: number, resetValue: number, getNextValue: (index: number) => number): string | null {
    const dictionary: string[] = [];
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    let entry = '';
    const result: string[] = [];
    let w: string;
    let c: string | number;
    let bits: number, resb: number, maxpower: number, power: number;
    const data = { val: getNextValue(0), position: resetValue, index: 1 };

    for (let i = 0; i < 3; i++) {
      dictionary[i] = String(i);
    }

    bits = 0;
    maxpower = Math.pow(2, 2);
    power = 1;
    while (power !== maxpower) {
      resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }

    const next = bits;
    switch (next) {
      case 0:
        bits = 0;
        maxpower = Math.pow(2, 8);
        power = 1;
        while (power !== maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        c = String.fromCharCode(bits);
        break;
      case 1:
        bits = 0;
        maxpower = Math.pow(2, 16);
        power = 1;
        while (power !== maxpower) {
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0) {
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        c = String.fromCharCode(bits);
        break;
      case 2:
        return '';
    }
    dictionary[3] = c as string;
    w = c as string;
    result.push(c as string);
    while (true) {
      if (data.index > length) {
        return '';
      }

      bits = 0;
      maxpower = Math.pow(2, numBits);
      power = 1;
      while (power !== maxpower) {
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0) {
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }

      switch ((c = bits)) {
        case 0:
          bits = 0;
          maxpower = Math.pow(2, 8);
          power = 1;
          while (power !== maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }

          dictionary[dictSize++] = String.fromCharCode(bits);
          c = dictSize - 1;
          enlargeIn--;
          break;
        case 1:
          bits = 0;
          maxpower = Math.pow(2, 16);
          power = 1;
          while (power !== maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0) {
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = String.fromCharCode(bits);
          c = dictSize - 1;
          enlargeIn--;
          break;
        case 2:
          return result.join('');
      }

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

      if (dictionary[c]) {
        entry = dictionary[c];
      } else {
        if (c === dictSize) {
          entry = w + w.charAt(0);
        } else {
          return null;
        }
      }
      result.push(entry);

      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;

      if (enlargeIn === 0) {
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }

      w = entry;
    }
  }

  return {
    compressToEncodedURIComponent,
    decompressFromEncodedURIComponent,
  };
})();

// ============================================
// Shareable State & URL Management
// ============================================

interface ShareableState {
  q: string;  // query
  s: string;  // scoring method
  r: ShareableResult[];  // results
}

interface ShareableResult {
  u: string;  // url
  t: string;  // title
  n: string;  // snippet
  c: string;  // source
  p: number;  // score (percentage)
}

function encodeStateToURL(query: string, scoring: string, results: SearchResult[]): string {
  const state: ShareableState = {
    q: query,
    s: scoring,
    r: results.map(r => ({
      u: r.url,
      t: r.title,
      n: r.snippet.slice(0, 150),  // Truncate for URL size
      c: r.source,
      p: Math.round((r.score ?? r.bm25Score ?? r.similarity ?? 0) * 100),
    })),
  };
  const json = JSON.stringify(state);
  const compressed = LZString.compressToEncodedURIComponent(json);
  return compressed;
}

function decodeStateFromURL(hash: string): ShareableState | null {
  try {
    const decompressed = LZString.decompressFromEncodedURIComponent(hash);
    if (!decompressed) return null;
    return JSON.parse(decompressed) as ShareableState;
  } catch (e) {
    console.error('Failed to decode URL state:', e);
    return null;
  }
}

function updateURLWithResults(query: string, scoring: string, results: SearchResult[]): void {
  if (results.length === 0) return;
  const encoded = encodeStateToURL(query, scoring, results);
  const newURL = `${window.location.pathname}#${encoded}`;
  window.history.replaceState(null, '', newURL);
  updateURLStats();
}

function updateURLStats(): void {
  const statsEl = document.getElementById('url-stats');
  if (!statsEl) return;

  const hash = window.location.hash;
  const bytes = new Blob([hash]).size;
  const kb = (bytes / 1024).toFixed(1);

  // Color code based on size
  let color = 'var(--success)';  // Green < 8KB
  if (bytes > 32000) color = '#f85149';  // Red > 32KB (risky)
  else if (bytes > 16000) color = 'var(--warning)';  // Yellow > 16KB

  statsEl.innerHTML = `<span style="color: ${color}">${kb}KB</span> / 32KB`;
  statsEl.title = `${bytes.toLocaleString()} bytes in URL hash`;
}

// ============================================
// Bookmark Export/Import (Abuse bookmarks as sync!)
// ============================================

interface BookmarkExport {
  v: number;  // version
  t: string;  // type: 'saved' | 'search'
  d: string;  // date exported
  s: SavedResult[] | ShareableResult[];
}

function exportSavedToBookmarkURL(): string {
  const saved = getSavedResults();
  if (saved.length === 0) {
    showToast('No saved results to export');
    return '';
  }

  // Compress saved results into minimal format
  const exportData: BookmarkExport = {
    v: 1,
    t: 'saved',
    d: new Date().toISOString().slice(0, 10),
    s: saved.map(r => ({
      u: r.url,
      t: r.title,
      n: r.snippet.slice(0, 100),
      c: r.source,
      p: 0,
    })),
  };

  const json = JSON.stringify(exportData);
  const compressed = LZString.compressToEncodedURIComponent(json);
  const url = `${window.location.origin}${window.location.pathname}#import:${compressed}`;

  // Show stats
  const bytes = new Blob([url]).size;
  const kb = (bytes / 1024).toFixed(1);
  showToast(`Exported ${saved.length} results (${kb}KB)`);

  return url;
}

function importFromBookmarkURL(hash: string): boolean {
  if (!hash.startsWith('import:')) return false;

  try {
    const compressed = hash.slice(7);  // Remove 'import:' prefix
    const json = LZString.decompressFromEncodedURIComponent(compressed);
    if (!json) throw new Error('Decompression failed');

    const data = JSON.parse(json) as BookmarkExport;

    if (data.t === 'saved' && Array.isArray(data.s)) {
      let imported = 0;
      for (const r of data.s) {
        const result: SearchResult = {
          url: (r as ShareableResult).u,
          title: (r as ShareableResult).t,
          snippet: (r as ShareableResult).n,
          source: (r as ShareableResult).c,
          timestamp: new Date(),
          score: 0,
        };

        if (!isResultSaved(result.url)) {
          saveResult(result);
          imported++;
        }
      }

      showToast(`Imported ${imported} new results (${data.s.length - imported} duplicates)`);
      renderSavedResults();
      if (currentResults.length > 0) {
        renderResults(currentResults);
      }

      // Clear the import hash
      window.history.replaceState(null, '', window.location.pathname);
      return true;
    }
  } catch (e) {
    console.error('Import failed:', e);
    showToast('Failed to import - invalid bookmark URL');
  }

  return false;
}

function getExportStats(): { count: number; estimatedKB: number; maxResults: number } {
  const saved = getSavedResults();

  // Estimate compressed size
  const sample = saved.slice(0, 10);
  const sampleJSON = JSON.stringify(sample.map(r => ({
    u: r.url, t: r.title, n: r.snippet.slice(0, 100), c: r.source, p: 0,
  })));
  const sampleCompressed = LZString.compressToEncodedURIComponent(sampleJSON);
  const bytesPerResult = sample.length > 0 ? sampleCompressed.length / sample.length : 150;

  const estimatedBytes = saved.length * bytesPerResult + 100;  // +100 for overhead
  const maxResults = Math.floor(30000 / bytesPerResult);  // 30KB safe limit

  return {
    count: saved.length,
    estimatedKB: estimatedBytes / 1024,
    maxResults,
  };
}

function getStateFromURL(): ShareableState | null {
  const hash = window.location.hash.slice(1);  // Remove #
  if (!hash) return null;
  return decodeStateFromURL(hash);
}

// ============================================
// Local Storage for Saved Results
// ============================================

const SAVED_RESULTS_KEY = 'rscout_saved_results';

interface SavedResult extends SearchResult {
  savedAt: string;  // ISO date string
  id: string;  // unique identifier
}

function getSavedResults(): SavedResult[] {
  try {
    const stored = localStorage.getItem(SAVED_RESULTS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load saved results:', e);
    return [];
  }
}

function saveResult(result: SearchResult): SavedResult {
  const saved = getSavedResults();
  const newResult: SavedResult = {
    ...result,
    savedAt: new Date().toISOString(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };

  // Check if already saved (by URL)
  if (saved.some(s => s.url === result.url)) {
    return saved.find(s => s.url === result.url)!;
  }

  saved.unshift(newResult);  // Add to beginning
  localStorage.setItem(SAVED_RESULTS_KEY, JSON.stringify(saved));
  return newResult;
}

function removeSavedResult(id: string): void {
  const saved = getSavedResults();
  const filtered = saved.filter(r => r.id !== id);
  localStorage.setItem(SAVED_RESULTS_KEY, JSON.stringify(filtered));
}

function isResultSaved(url: string): boolean {
  return getSavedResults().some(s => s.url === url);
}

function clearAllSavedResults(): void {
  localStorage.removeItem(SAVED_RESULTS_KEY);
}

// ============================================
// Core Types
// ============================================

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

// Store current results for save functionality
let currentResults: SearchResult[] = [];

function renderResults(results: SearchResult[], isSharedView: boolean = false): void {
  currentResults = results;

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

  resultsDiv.innerHTML = results.map((result, index) => {
    const score = result.score ?? result.bm25Score ?? result.similarity ?? 0;
    const normalizedScore = (score / maxScore) * 100;
    const isSaved = isResultSaved(result.url);

    let domain = 'unknown';
    try {
      domain = new URL(result.url).hostname.replace('www.', '');
    } catch {}

    // Escape HTML in title and snippet
    const safeTitle = (result.title || 'Untitled').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeSnippet = result.snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
      <div class="result-card" data-index="${index}">
        <div class="result-header">
          <div class="result-title">
            <a href="${result.url}" target="_blank" rel="noopener">${safeTitle}</a>
          </div>
          <button class="save-btn ${isSaved ? 'saved' : ''}" data-index="${index}" title="${isSaved ? 'Saved' : 'Save to collection'}">
            ${isSaved ? '★' : '☆'}
          </button>
        </div>
        <div class="result-snippet">${safeSnippet.slice(0, 200)}${safeSnippet.length > 200 ? '...' : ''}</div>
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

  // Add click handlers for save buttons
  resultsDiv.querySelectorAll('.save-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const index = parseInt((btn as HTMLElement).dataset.index || '0', 10);
      const result = currentResults[index];
      if (result) {
        if (isResultSaved(result.url)) {
          // Already saved, show feedback
          showToast('Already saved to collection');
        } else {
          saveResult(result);
          btn.classList.add('saved');
          btn.innerHTML = '★';
          btn.setAttribute('title', 'Saved');
          showToast('Saved to collection');
          renderSavedResults();
        }
      }
    });
  });
}

function showToast(message: string): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

function renderSavedResults(): void {
  const savedDiv = document.getElementById('saved-results');
  const savedListDiv = document.getElementById('saved-list');
  const savedCountSpan = document.getElementById('saved-count');

  if (!savedDiv || !savedListDiv || !savedCountSpan) return;

  const saved = getSavedResults();
  savedCountSpan.textContent = `(${saved.length})`;

  // Update export stats whenever saved results change
  updateExportStats();

  if (saved.length === 0) {
    savedListDiv.innerHTML = `
      <div class="empty-state" style="padding: 1rem;">
        <p style="font-size: 0.9rem;">No saved results yet</p>
        <p style="margin-top: 0.25rem; font-size: 0.8rem;">Click ☆ on any result to save it</p>
      </div>
    `;
    return;
  }

  savedListDiv.innerHTML = saved.map((result) => {
    let domain = 'unknown';
    try {
      domain = new URL(result.url).hostname.replace('www.', '');
    } catch {}

    const savedDate = new Date(result.savedAt).toLocaleDateString();
    const safeTitle = (result.title || 'Untitled').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return `
      <div class="saved-item" data-id="${result.id}">
        <div class="saved-item-content">
          <a href="${result.url}" target="_blank" rel="noopener">${safeTitle}</a>
          <span class="saved-item-meta">${domain} • ${result.source} • ${savedDate}</span>
        </div>
        <button class="remove-saved-btn" data-id="${result.id}" title="Remove">×</button>
      </div>
    `;
  }).join('');

  // Add click handlers for remove buttons
  savedListDiv.querySelectorAll('.remove-saved-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id;
      if (id) {
        removeSavedResult(id);
        renderSavedResults();
        // Re-render current results to update save button states
        if (currentResults.length > 0) {
          renderResults(currentResults);
        }
        showToast('Removed from collection');
      }
    });
  });
}

function copyShareLink(): void {
  const url = window.location.href;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied to clipboard!');
  }).catch(() => {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = url;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showToast('Link copied to clipboard!');
  });
}

function showSharePanel(show: boolean): void {
  const panel = document.getElementById('share-panel');
  if (panel) {
    panel.style.display = show ? 'flex' : 'none';
  }
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

    // Update URL with compressed results for sharing
    updateURLWithResults(query, scoring, results);
    showSharePanel(true);
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

// ============================================
// Initialization
// ============================================

function initializeFromURL(): boolean {
  const hash = window.location.hash.slice(1);
  if (!hash) return false;

  // Check for import URL first
  if (hash.startsWith('import:')) {
    return importFromBookmarkURL(hash);
  }

  // Otherwise try to restore search results
  const state = getStateFromURL();
  if (!state || !state.r || state.r.length === 0) return false;

  // Restore UI state
  queryInput.value = state.q || '';
  if (state.s && ['bm25', 'tfidf', 'semantic'].includes(state.s)) {
    scoringSelect.value = state.s;
  }

  // Convert shareable results back to SearchResult format
  const results: SearchResult[] = state.r.map((r) => ({
    url: r.u,
    title: r.t,
    snippet: r.n,
    source: r.c,
    timestamp: new Date(),
    score: r.p / 100,  // Convert percentage back to decimal
  }));

  // Render the shared results
  renderResults(results, true);
  showSharePanel(true);
  updateURLStats();
  setStatus(`Viewing shared results for "${state.q}"`, 'ready');

  return true;
}

function setupSharePanel(): void {
  const copyBtn = document.getElementById('copy-link-btn');
  const clearUrlBtn = document.getElementById('clear-url-btn');

  if (copyBtn) {
    copyBtn.addEventListener('click', copyShareLink);
  }

  if (clearUrlBtn) {
    clearUrlBtn.addEventListener('click', () => {
      // Clear URL hash and hide share panel
      window.history.replaceState(null, '', window.location.pathname);
      showSharePanel(false);
      showToast('Share link cleared');
    });
  }
}

function setupSavedResultsPanel(): void {
  const toggleBtn = document.getElementById('toggle-saved');
  const savedPanel = document.getElementById('saved-results');
  const clearAllBtn = document.getElementById('clear-all-saved');
  const exportBtn = document.getElementById('export-saved-btn');

  if (toggleBtn && savedPanel) {
    toggleBtn.addEventListener('click', () => {
      const isVisible = savedPanel.style.display !== 'none';
      savedPanel.style.display = isVisible ? 'none' : 'block';
      toggleBtn.textContent = isVisible ? 'Show Saved' : 'Hide Saved';
    });
  }

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      if (confirm('Clear all saved results? This cannot be undone.')) {
        clearAllSavedResults();
        renderSavedResults();
        if (currentResults.length > 0) {
          renderResults(currentResults);
        }
        showToast('All saved results cleared');
      }
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const url = exportSavedToBookmarkURL();
      if (url) {
        // Copy to clipboard
        navigator.clipboard.writeText(url).then(() => {
          const stats = getExportStats();
          showToast(`Bookmark URL copied! (${stats.estimatedKB.toFixed(1)}KB for ${stats.count} results)`);
        }).catch(() => {
          // Fallback: open prompt with URL
          prompt('Bookmark this URL to sync your saved results:', url);
        });
      }
    });
  }

  // Initial render
  renderSavedResults();
  updateExportStats();
}

function updateExportStats(): void {
  const statsEl = document.getElementById('export-stats');
  if (!statsEl) return;

  const stats = getExportStats();
  if (stats.count === 0) {
    statsEl.textContent = '';
    return;
  }

  const pct = Math.min(100, (stats.estimatedKB / 30) * 100);
  let color = 'var(--success)';
  if (pct > 90) color = '#f85149';
  else if (pct > 60) color = 'var(--warning)';

  statsEl.innerHTML = `
    <span style="color: ${color}">${stats.estimatedKB.toFixed(1)}KB</span> / 30KB
    (~${stats.maxResults} max results)
  `;
}

// Initialize app
const hasSharedState = initializeFromURL();
setupSharePanel();
setupSavedResultsPanel();

if (!hasSharedState) {
  setStatus('Ready to search', 'ready');
}
