import { createChildLogger } from '../utils/logger.js';

const logger = createChildLogger('chunker');

// Lazy load tree-sitter
let Parser: typeof import('web-tree-sitter') | null = null;

async function getParser() {
  if (!Parser) {
    Parser = (await import('web-tree-sitter')).default;
    await Parser.init();
  }
  return Parser;
}

export interface CodeChunk {
  content: string;
  type: 'function' | 'class' | 'method' | 'block' | 'full';
  name?: string;
  startLine: number;
  endLine: number;
  language: string;
}

export interface ChunkOptions {
  maxChunkSize?: number;     // Maximum characters per chunk
  minChunkSize?: number;     // Minimum characters to create a chunk
  overlap?: number;          // Character overlap between chunks
  preserveStructure?: boolean; // Try to preserve code structure
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
  '.cs': 'c_sharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
};

// Language-specific node types for functions and classes
const FUNCTION_TYPES: Record<string, string[]> = {
  javascript: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  typescript: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  python: ['function_definition', 'async_function_definition'],
  go: ['function_declaration', 'method_declaration'],
  rust: ['function_item', 'impl_item'],
  java: ['method_declaration', 'constructor_declaration'],
  cpp: ['function_definition'],
  c: ['function_definition'],
};

const CLASS_TYPES: Record<string, string[]> = {
  javascript: ['class_declaration', 'class'],
  typescript: ['class_declaration', 'class'],
  python: ['class_definition'],
  java: ['class_declaration', 'interface_declaration'],
  cpp: ['class_specifier', 'struct_specifier'],
  rust: ['struct_item', 'enum_item', 'trait_item'],
  go: ['type_declaration'],
};

/**
 * AST-aware code chunker using tree-sitter.
 * Preserves semantic structure by chunking at function/class boundaries.
 *
 * Based on Continue.dev's approach:
 * 1. Check if entire file fits within context window
 * 2. If not, extract all top-level functions and classes
 * 3. For oversized components, truncate sub-method contents
 */
export class ASTChunker {
  private parserCache = new Map<string, InstanceType<typeof import('web-tree-sitter')>>();
  private languageCache = new Map<string, import('web-tree-sitter').Language>();

  constructor(private options: ChunkOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 4000,
      minChunkSize: options.minChunkSize ?? 100,
      overlap: options.overlap ?? 0,
      preserveStructure: options.preserveStructure ?? true,
    };
  }

  /**
   * Chunk code content into semantic pieces
   */
  async chunkCode(
    content: string,
    language: string,
    filename?: string
  ): Promise<CodeChunk[]> {
    const maxSize = this.options.maxChunkSize ?? 4000;

    // If content fits in one chunk, return as-is
    if (content.length <= maxSize) {
      return [{
        content,
        type: 'full',
        startLine: 1,
        endLine: content.split('\n').length,
        language,
      }];
    }

    // Try AST-aware chunking
    if (this.options.preserveStructure) {
      try {
        const astChunks = await this.chunkByAST(content, language);
        if (astChunks.length > 0) {
          return astChunks;
        }
      } catch (error) {
        logger.warn({ language, error }, 'AST chunking failed, falling back to line-based');
      }
    }

    // Fallback to line-based chunking
    return this.chunkByLines(content, language);
  }

  /**
   * Chunk code using AST parsing
   */
  private async chunkByAST(content: string, language: string): Promise<CodeChunk[]> {
    const TreeSitter = await getParser();

    // Get or create parser for this language
    let parser = this.parserCache.get(language);
    if (!parser) {
      parser = new TreeSitter();
      this.parserCache.set(language, parser);
    }

    // Load language if not cached
    let lang = this.languageCache.get(language);
    if (!lang) {
      try {
        // Note: In production, you'd download and load the actual .wasm files
        // For now, we'll use the JavaScript grammar as an example
        const wasmPath = `https://unpkg.com/tree-sitter-${language}/tree-sitter-${language}.wasm`;
        lang = await TreeSitter.Language.load(wasmPath);
        this.languageCache.set(language, lang);
        parser.setLanguage(lang);
      } catch (error) {
        logger.warn({ language }, 'Language not available, skipping AST parsing');
        return [];
      }
    } else {
      parser.setLanguage(lang);
    }

    const tree = parser.parse(content);
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');
    const maxSize = this.options.maxChunkSize ?? 4000;

    // Get top-level declarations
    const functionTypes = FUNCTION_TYPES[language] ?? [];
    const classTypes = CLASS_TYPES[language] ?? [];

    const processNode = (node: import('web-tree-sitter').SyntaxNode) => {
      const nodeType = node.type;

      // Check if this is a function or class
      if (functionTypes.includes(nodeType) || classTypes.includes(nodeType)) {
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const nodeContent = lines.slice(startLine - 1, endLine).join('\n');

        // Extract name
        const nameNode = node.childForFieldName('name');
        const name = nameNode?.text;

        const chunkType = classTypes.includes(nodeType) ? 'class' : 'function';

        if (nodeContent.length <= maxSize) {
          chunks.push({
            content: nodeContent,
            type: chunkType,
            name,
            startLine,
            endLine,
            language,
          });
        } else {
          // Chunk is too large, try to split by methods/inner functions
          const innerChunks = this.splitLargeNode(node, lines, language, maxSize);
          chunks.push(...innerChunks);
        }
      }
    };

    // Walk the tree
    const cursor = tree.walk();

    const walk = () => {
      processNode(cursor.currentNode);

      if (cursor.gotoFirstChild()) {
        do {
          walk();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    walk();

    // If no chunks were created, the file might be mostly top-level code
    if (chunks.length === 0) {
      return this.chunkByLines(content, language);
    }

    return chunks;
  }

  /**
   * Split a large AST node into smaller chunks
   */
  private splitLargeNode(
    node: import('web-tree-sitter').SyntaxNode,
    lines: string[],
    language: string,
    maxSize: number
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const functionTypes = FUNCTION_TYPES[language] ?? [];

    // Find inner functions/methods
    const cursor = node.walk();
    const innerNodes: import('web-tree-sitter').SyntaxNode[] = [];

    if (cursor.gotoFirstChild()) {
      do {
        if (functionTypes.includes(cursor.currentNode.type)) {
          innerNodes.push(cursor.currentNode);
        }
      } while (cursor.gotoNextSibling());
    }

    if (innerNodes.length === 0) {
      // No inner functions, just chunk by lines
      const startLine = node.startPosition.row + 1;
      const endLine = node.endPosition.row + 1;
      const nodeContent = lines.slice(startLine - 1, endLine).join('\n');

      return this.chunkText(nodeContent, language, startLine);
    }

    // Create chunks for each inner function
    for (const innerNode of innerNodes) {
      const startLine = innerNode.startPosition.row + 1;
      const endLine = innerNode.endPosition.row + 1;
      const content = lines.slice(startLine - 1, endLine).join('\n');
      const nameNode = innerNode.childForFieldName('name');

      if (content.length <= maxSize) {
        chunks.push({
          content,
          type: 'method',
          name: nameNode?.text,
          startLine,
          endLine,
          language,
        });
      } else {
        // Still too large, truncate
        chunks.push({
          content: content.slice(0, maxSize) + '\n// ... truncated',
          type: 'method',
          name: nameNode?.text,
          startLine,
          endLine,
          language,
        });
      }
    }

    return chunks;
  }

  /**
   * Chunk code by line boundaries (fallback)
   */
  private chunkByLines(content: string, language: string): CodeChunk[] {
    const lines = content.split('\n');
    const maxSize = this.options.maxChunkSize ?? 4000;
    const minSize = this.options.minChunkSize ?? 100;
    const overlap = this.options.overlap ?? 0;

    const chunks: CodeChunk[] = [];
    let currentChunk: string[] = [];
    let currentSize = 0;
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineSize = line.length + 1; // +1 for newline

      if (currentSize + lineSize > maxSize && currentChunk.length > 0) {
        // Save current chunk
        const chunkContent = currentChunk.join('\n');
        if (chunkContent.length >= minSize) {
          chunks.push({
            content: chunkContent,
            type: 'block',
            startLine,
            endLine: startLine + currentChunk.length - 1,
            language,
          });
        }

        // Start new chunk with overlap
        if (overlap > 0) {
          const overlapLines = Math.ceil(overlap / 80); // Assume ~80 chars per line
          currentChunk = currentChunk.slice(-overlapLines);
          currentSize = currentChunk.join('\n').length;
          startLine = i + 1 - overlapLines;
        } else {
          currentChunk = [];
          currentSize = 0;
          startLine = i + 1;
        }
      }

      currentChunk.push(line);
      currentSize += lineSize;
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      const chunkContent = currentChunk.join('\n');
      if (chunkContent.length >= minSize) {
        chunks.push({
          content: chunkContent,
          type: 'block',
          startLine,
          endLine: startLine + currentChunk.length - 1,
          language,
        });
      }
    }

    return chunks;
  }

  /**
   * Chunk arbitrary text
   */
  private chunkText(content: string, language: string, baseStartLine: number): CodeChunk[] {
    const maxSize = this.options.maxChunkSize ?? 4000;
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');

    let currentChunk: string[] = [];
    let currentSize = 0;
    let relativeStartLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineSize = line.length + 1;

      if (currentSize + lineSize > maxSize && currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.join('\n'),
          type: 'block',
          startLine: baseStartLine + relativeStartLine,
          endLine: baseStartLine + relativeStartLine + currentChunk.length - 1,
          language,
        });

        currentChunk = [];
        currentSize = 0;
        relativeStartLine = i;
      }

      currentChunk.push(line);
      currentSize += lineSize;
    }

    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.join('\n'),
        type: 'block',
        startLine: baseStartLine + relativeStartLine,
        endLine: baseStartLine + relativeStartLine + currentChunk.length - 1,
        language,
      });
    }

    return chunks;
  }

  /**
   * Detect language from filename
   */
  static detectLanguage(filename: string): string | null {
    const ext = filename.slice(filename.lastIndexOf('.'));
    return LANGUAGE_EXTENSIONS[ext] ?? null;
  }
}

/**
 * Simple text chunker for non-code content
 */
export class TextChunker {
  constructor(private options: ChunkOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 2000,
      minChunkSize: options.minChunkSize ?? 100,
      overlap: options.overlap ?? 200,
    };
  }

  /**
   * Chunk text by paragraphs/sentences
   */
  chunk(content: string): string[] {
    const maxSize = this.options.maxChunkSize ?? 2000;
    const minSize = this.options.minChunkSize ?? 100;
    const overlap = this.options.overlap ?? 200;

    // Split by paragraphs first
    const paragraphs = content.split(/\n\n+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length + 2 <= maxSize) {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      } else {
        if (currentChunk.length >= minSize) {
          chunks.push(currentChunk);
        }

        // Add overlap from end of previous chunk
        if (overlap > 0 && currentChunk.length > 0) {
          const overlapText = currentChunk.slice(-overlap);
          currentChunk = overlapText + '\n\n' + paragraph;
        } else {
          currentChunk = paragraph;
        }

        // If single paragraph is too large, split by sentences
        if (currentChunk.length > maxSize) {
          const sentenceChunks = this.chunkBySentences(currentChunk, maxSize, minSize);
          chunks.push(...sentenceChunks.slice(0, -1));
          currentChunk = sentenceChunks[sentenceChunks.length - 1] ?? '';
        }
      }
    }

    if (currentChunk.length >= minSize) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private chunkBySentences(text: string, maxSize: number, minSize: number): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= maxSize) {
        currentChunk += sentence;
      } else {
        if (currentChunk.length >= minSize) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}
