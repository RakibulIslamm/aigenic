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
  const dot = name.lastIndexOf('.');
  // No dot, or a dotfile with nothing before it (".pdf"), has no extension.
  if (dot <= 0) return null;
  return KIND_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * Upper bound on parsing one file. pdf.js and mammoth can't be cancelled, but
 * a crafted or pathological file mustn't hold the request until the platform
 * kills it with an opaque error — the owner gets a clear one instead.
 */
const EXTRACT_TIMEOUT_MS = 30_000;

class ExtractTimeout extends Error {}

export async function extractText(file: File): Promise<ExtractResult> {
  const kind = kindForFileName(file.name);
  if (!kind) {
    return { ok: false, error: 'Unsupported file type.' };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: 'The upload was incomplete. Try again.' };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'The file is empty.' };
  }

  let raw: string | null;
  try {
    raw = await withTimeout(readRaw(kind, bytes), EXTRACT_TIMEOUT_MS);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof ExtractTimeout
          ? 'This file took too long to read. Try splitting it into smaller files.'
          : 'Could not read this file. It may be damaged or password-protected.',
    };
  }
  if (raw === null) {
    return {
      ok: false,
      error: "This doesn't look like a text file — check it's the right file and type.",
    };
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
}

/** Raw text for one file; null when a "text" file turns out to be binary. */
async function readRaw(kind: Kind, bytes: Uint8Array): Promise<string | null> {
  switch (kind) {
    case 'pdf': {
      // Lazy: pdf.js is heavy, and most requests never touch a PDF.
      const { extractText: extractPdf } = await import('unpdf');
      const { text } = await extractPdf(bytes, { mergePages: false });
      // Page breaks become paragraph breaks; within a page, pdf.js gives
      // one line per text run — rejoin those into flowing paragraphs.
      return text.map(unwrapLines).join('\n\n');
    }
    case 'docx': {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return value;
    }
    case 'html': {
      const decoded = decodeText(bytes);
      return decoded === null ? null : htmlToText(decoded);
    }
    case 'text':
      return decodeText(bytes);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExtractTimeout()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Bytes of a "text" upload → string, whatever editor wrote it:
 *
 * - UTF-16 with a byte-order mark (what Windows Notepad and Excel's
 *   "Unicode text" export produce);
 * - UTF-8, with or without a BOM — the common case, decoded strictly so a
 *   file that *isn't* UTF-8 is caught rather than filled with `�`;
 * - otherwise Windows-1252, the legacy default those same tools used for
 *   years (a superset of Latin-1, so plain ASCII is unaffected).
 *
 * Null for something that's actually binary (an image or archive renamed to
 * `.txt`): NUL bytes never occur in real text outside UTF-16.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeAs('utf-16le', bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeAs('utf-16be', bytes);

  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return null;

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return decodeAs('windows-1252', bytes);
  }
}

function decodeAs(encoding: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    // A runtime without full ICU lacks the legacy encodings; lossy UTF-8 is
    // still better than refusing the file.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Control characters other than tab/newline/CR/FF/VT. NUL in particular:
 * Postgres `text` rejects it outright, so one stray byte would fail the insert.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000E-\u001F\u007F]/g;

/**
 * Collapses whitespace inside paragraphs and limits blank lines to one, so
 * paragraphs survive (the chunker splits on them) and nothing else does.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
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
 * Pasted text is kept as the owner wrote it — Markdown indentation and all —
 * minus what can't be stored (control characters) and runs of blank lines.
 */
export function cleanPastedText(raw: string): string {
  return raw
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
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
