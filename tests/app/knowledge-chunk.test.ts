import { describe, expect, it } from 'vitest';
import { CHUNK_MAX_CHARS, chunkDocument } from '@/lib/knowledge/chunk';

/**
 * Uploaded documents are split so search ranks a long manual's sections
 * separately. Losing or reordering text here would silently drop knowledge;
 * an oversized chunk would blow the agent's context on `get_article`.
 */

const para = (n: number, len = 1000) =>
  `Paragraph ${n}. ` +
  'lorem ipsum dolor sit amet. '.repeat(Math.ceil(len / 28)).slice(0, len);

describe('chunkDocument', () => {
  it('keeps a short document whole, with its title unchanged', () => {
    expect(chunkDocument('Returns', 'We accept returns within 30 days.')).toEqual([
      { title: 'Returns', content: 'We accept returns within 30 days.' },
    ]);
  });

  it('returns nothing for blank text', () => {
    expect(chunkDocument('Empty', '  \n\n  ')).toEqual([]);
  });

  it('splits a long document at paragraph boundaries, numbering the parts', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => para(i));
    const chunks = chunkDocument('Handbook', paragraphs.join('\n\n'));

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, i) => {
      expect(chunk.title).toBe(`Handbook (part ${i + 1}/${chunks.length})`);
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      // Paragraph boundaries are respected: every chunk starts a paragraph.
      expect(chunk.content).toMatch(/^Paragraph \d+\./);
    });
    // Nothing lost, nothing reordered.
    expect(chunks.map((c) => c.content).join('\n\n')).toBe(paragraphs.join('\n\n'));
  });

  it('splits a single giant paragraph by sentence, never past the max', () => {
    const sentence = 'This sentence is about forty characters. ';
    const chunks = chunkDocument('Wall', sentence.repeat(1000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(chunk.content.endsWith('.')).toBe(true);
    }
  });

  it('hard-cuts text with no sentence breaks at all', () => {
    const chunks = chunkDocument('Blob', 'x'.repeat(CHUNK_MAX_CHARS * 2 + 10));
    expect(chunks.map((c) => c.content.length)).toEqual([
      CHUNK_MAX_CHARS,
      CHUNK_MAX_CHARS,
      10,
    ]);
  });
});
