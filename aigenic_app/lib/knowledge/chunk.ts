/**
 * Splits a long document into chunks the agent can search and read.
 *
 * One row per uploaded PDF would make search rank a 100-page manual as a
 * single hit, show the excerpt from page one whatever matched, and hand the
 * model the whole book on `get_article`. Chunks of a few thousand characters
 * match the size of a crawled page — which is what every downstream piece
 * (ranking, excerpts, the context budget) was tuned for.
 *
 * Pure and import-free: tested without a database.
 */

/** Aim for chunks about this long… */
export const CHUNK_TARGET_CHARS = 6_000;
/** …and never longer than this. */
export const CHUNK_MAX_CHARS = 8_000;

export interface DocumentChunk {
  title: string;
  content: string;
}

/**
 * Packs paragraphs into chunks of about `target` characters, splitting an
 * oversized paragraph at sentence boundaries — and, failing those, hard at
 * `max`. A document that fits in one chunk keeps its title unchanged; a longer
 * one gets "(part n/m)" so each search hit says where it came from.
 */
export function chunkDocument(
  title: string,
  text: string,
  { target = CHUNK_TARGET_CHARS, max = CHUNK_MAX_CHARS } = {},
): DocumentChunk[] {
  const pieces = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length <= max ? [p] : splitLong(p, max)));

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const joined = current ? `${current}\n\n${piece}` : piece;
    if (joined.length <= target || !current) {
      current = joined;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);

  if (chunks.length <= 1) {
    return chunks.map((content) => ({ title, content }));
  }
  return chunks.map((content, i) => ({
    title: `${title} (part ${i + 1}/${chunks.length})`,
    content,
  }));
}

/** Splits at sentence ends where possible, hard-cuts at `max` where not. */
function splitLong(paragraph: string, max: number): string[] {
  const sentences = paragraph.match(/[^.!?]+(?:[.!?]+|$)\s*/g) ?? [paragraph];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length <= max) {
      current += sentence;
      continue;
    }
    if (current) out.push(current.trim());
    current = sentence;
    while (current.length > max) {
      out.push(current.slice(0, max).trim());
      current = current.slice(max);
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
