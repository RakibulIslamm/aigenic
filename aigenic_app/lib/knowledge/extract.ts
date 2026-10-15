import 'server-only';

/**
 * Turns an uploaded file into plain text for the knowledge base.
 *
 * Every format ends up as paragraphs separated by blank lines — the shape
 * `chunkDocument` splits on — with runs of whitespace collapsed, so a PDF's
 * hard-wrapped lines and an HTML page's indentation don't waste the agent's
 * context.
 */

export type ExtractResult = { ok: true; text: string } | { ok: false; error: string };

type Kind = 'pdf' | 'docx' | 'html' | 'text';

const KIND_BY_EXTENSION: Record<string, Kind> = {
  pdf: 'pdf',
  docx: 'docx',
  html: 'html',
  htm: 'html',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
};

/** The extractor for a file name, or null when the type isn't supported. */
export function kindForFileName(name: string): Kind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return KIND_BY_EXTENSION[ext] ?? null;
}

export async function extractText(file: File): Promise<ExtractResult> {
  const kind = kindForFileName(file.name);
  if (!kind) {
    return { ok: false, error: 'Unsupported file type.' };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    let raw: string;
    switch (kind) {
      case 'pdf': {
        // Lazy: pdf.js is heavy, and most requests never touch a PDF.
        const { extractText: extractPdf } = await import('unpdf');
        const { text } = await extractPdf(bytes, { mergePages: false });
        // Page breaks become paragraph breaks; within a page, pdf.js gives
        // one line per text run — rejoin those into flowing paragraphs.
        raw = text.map(unwrapLines).join('\n\n');
        break;
      }
      case 'docx': {
        const mammoth = await import('mammoth');
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        raw = value;
        break;
      }
      case 'html':
        raw = htmlToText(new TextDecoder().decode(bytes));
        break;
      case 'text':
        raw = new TextDecoder().decode(bytes);
        break;
    }
    const text = normalizeText(raw);
    if (!text) {
      return {
        ok: false,
        error:
          kind === 'pdf'
            ? 'No text found — this looks like a scanned PDF. Upload a version with selectable text.'
            : 'The file has no readable text.',
      };
    }
    return { ok: true, text };
  } catch {
    return {
      ok: false,
      error: 'Could not read this file. It may be damaged or password-protected.',
    };
  }
}

/**
 * Collapses whitespace inside paragraphs and limits blank lines to one, so
 * paragraphs survive (the chunker splits on them) and nothing else does.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split(/\n{2,}/)
    .map((p) =>
      p
        .split('\n')
        .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n'),
    )
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/**
 * pdf.js returns a page as hard-wrapped lines. A line ending in sentence
 * punctuation (or a short heading-like line) ends a paragraph; anything else
 * flows into the next line.
 */
function unwrapLines(page: string): string {
  const lines = page.split('\n').map((l) => l.trim());
  let out = '';
  for (const line of lines) {
    if (!line) {
      out += '\n\n';
      continue;
    }
    if (!out || out.endsWith('\n')) {
      out += line;
    } else if (/[.!?:]$/.test(out) || out.length - out.lastIndexOf('\n') < 60) {
      out += `\n${line}`;
    } else {
      out += ` ${line}`;
    }
  }
  return out;
}

const BLOCK_TAGS =
  'address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
};

/**
 * Good-enough HTML → text for a saved web page or exported help article:
 * drops scripts, styles and comments, turns block elements into paragraph
 * breaks, and decodes entities. No DOM needed for that.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
        const code =
          entity[1]?.toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    });
}
