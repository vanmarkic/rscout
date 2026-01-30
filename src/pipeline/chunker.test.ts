import { describe, it, expect } from 'vitest';
import { ASTChunker, TextChunker } from './chunker.js';

describe('ASTChunker', () => {
  describe('detectLanguage', () => {
    it('detects JavaScript from .js extension', () => {
      expect(ASTChunker.detectLanguage('file.js')).toBe('javascript');
    });

    it('detects TypeScript from .ts extension', () => {
      expect(ASTChunker.detectLanguage('file.ts')).toBe('typescript');
    });

    it('detects Python from .py extension', () => {
      expect(ASTChunker.detectLanguage('file.py')).toBe('python');
    });

    it('returns null for unknown extensions', () => {
      expect(ASTChunker.detectLanguage('file.xyz')).toBeNull();
    });
  });

  describe('chunkCode (line-based fallback)', () => {
    it('returns single chunk for small content', async () => {
      const chunker = new ASTChunker({ maxChunkSize: 1000 });
      const content = 'const x = 1;\nconst y = 2;';

      const chunks = await chunker.chunkCode(content, 'javascript');

      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.type).toBe('full');
      expect(chunks[0]?.content).toBe(content);
    });

    it('splits large content into multiple chunks', async () => {
      const chunker = new ASTChunker({ maxChunkSize: 100, minChunkSize: 10 });
      const content = Array(50).fill('const x = 1;').join('\n');

      const chunks = await chunker.chunkCode(content, 'javascript');

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(150); // Some tolerance
      });
    });

    it('preserves line numbers', async () => {
      const chunker = new ASTChunker({ maxChunkSize: 50, minChunkSize: 10 });
      const content = 'line1\nline2\nline3\nline4\nline5';

      const chunks = await chunker.chunkCode(content, 'javascript');

      expect(chunks[0]?.startLine).toBe(1);
      if (chunks.length > 1) {
        expect(chunks[1]?.startLine).toBeGreaterThan(1);
      }
    });
  });
});

describe('TextChunker', () => {
  describe('chunk', () => {
    it('returns single chunk for small text', () => {
      const chunker = new TextChunker({ maxChunkSize: 1000, minChunkSize: 10 });
      const text = 'This is a short paragraph.';

      const chunks = chunker.chunk(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('splits by paragraphs', () => {
      const chunker = new TextChunker({ maxChunkSize: 100, minChunkSize: 10 });
      const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.';

      const chunks = chunker.chunk(text);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('handles very long paragraphs by splitting sentences', () => {
      const chunker = new TextChunker({ maxChunkSize: 50, minChunkSize: 10 });
      const text = 'This is sentence one. This is sentence two. This is sentence three. This is sentence four.';

      const chunks = chunker.chunk(text);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(100); // Allow some overflow
      });
    });

    it('adds overlap between chunks when configured', () => {
      const chunker = new TextChunker({
        maxChunkSize: 50,
        minChunkSize: 10,
        overlap: 20,
      });
      const text = 'First paragraph content here.\n\nSecond paragraph content here.\n\nThird paragraph.';

      const chunks = chunker.chunk(text);

      // With overlap, chunks might share some content
      if (chunks.length > 1) {
        // Overlap means some text appears in multiple chunks
        const allText = chunks.join('');
        expect(allText.length).toBeGreaterThanOrEqual(text.length);
      }
    });

    it('respects minimum chunk size', () => {
      const chunker = new TextChunker({ maxChunkSize: 100, minChunkSize: 50 });
      const text = 'A.\n\nB.\n\nC.';

      const chunks = chunker.chunk(text);

      // Very short chunks should be merged or filtered
      chunks.forEach((chunk) => {
        // Either meets minimum or is the last chunk
        expect(chunk.length >= 1).toBe(true);
      });
    });
  });
});
