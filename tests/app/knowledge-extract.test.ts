import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cleanPastedText,
  decodeText,
  extractText,
  htmlToText,
  kindForFileName,
  normalizeText,
} from '@/lib/knowledge/extract';
import { MANUAL_UPLOAD_EXTENSIONS } from '@/lib/sites/limits';

describe('kindForFileName', () => {
  it.each([
    ['Policy.PDF', 'pdf'],
    ['guide.docx', 'docx'],
    ['faq.md', 'text'],
    ['page.htm', 'html'],
    ['prices.csv', 'text'],
  ])('%s → %s', (name, kind) => {
    expect(kindForFileName(name)).toBe(kind);
  });

  it('accepts every extension the upload dialog offers', () => {
    for (const ext of MANUAL_UPLOAD_EXTENSIONS) {
      expect(kindForFileName(`file${ext}`), ext).not.toBeNull();
    }
  });

  it.each(['photo.png', 'old.doc', 'archive.zip', 'noextension', 'pdf', '.pdf'])(
    'rejects %s',
    (name) => {
      expect(kindForFileName(name)).toBeNull();
    },
  );
});

describe('normalizeText', () => {
  it('collapses whitespace but keeps paragraph breaks', () => {
    expect(normalizeText('  One\t  two \r\n\r\n\r\n\n Three four  \n')).toBe(
      'One two\n\nThree four',
    );
  });
});

describe('htmlToText', () => {
  it('keeps text and structure, drops scripts, styles and markup', () => {
    const html = `<html><head><title>x</title><style>p{color:red}</style></head>
      <body><h1>Shipping</h1><script>alert(1)</script>
      <p>Free over &pound;50 &amp; <b>fast</b>.</p><ul><li>UK: 2 days</li><li>EU: 5&nbsp;days</li></ul>
      <!-- comment --></body></html>`;
    expect(normalizeText(htmlToText(html))).toBe(
      'Shipping\n\nFree over &pound;50 & fast.\n\nUK: 2 days\n\nEU: 5 days',
    );
  });

  it('decodes numeric entities', () => {
    expect(htmlToText('&#8364;10 &#x2014; ok')).toBe('€10 — ok');
  });
});

describe('extractText', () => {
  it('reads Markdown as text', async () => {
    const file = new File(['# FAQ\n\nDo you ship abroad?  Yes.\n'], 'faq.md');
    expect(await extractText(file)).toEqual({
      ok: true,
      text: '# FAQ\n\nDo you ship abroad? Yes.',
    });
  });

  it('rejects an empty document with a reason', async () => {
    const result = await extractText(new File(['   \n'], 'blank.txt'));
    expect(result.ok).toBe(false);
  });

  it('reports a corrupt PDF instead of throwing', async () => {
    const result = await extractText(new File(['not really a pdf'], 'broken.pdf'));
    expect(result).toMatchObject({ ok: false });
  });
});

describe('extractText — real files', () => {
  const fixture = (name: string) =>
    new File(
      [readFileSync(path.resolve(import.meta.dirname, '../fixtures', name))],
      name,
    );

  it('reads a multi-page PDF into paragraphs', async () => {
    const result = await extractText(fixture('policy.pdf'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('Returns Policy');
    // A hard-wrapped line in the PDF comes back as one flowing sentence.
    expect(result.text).toContain(
      'Items must be in their original packaging with tags attached.',
    );
    // Page 2 is there too.
    expect(result.text).toContain('two year warranty');
  });

  it('reads a Word document', async () => {
    const result = await extractText(fixture('hours.docx'));
    expect(result).toEqual({
      ok: true,
      text: 'Opening hours\n\nWe are open Monday to Friday, 9am to 6pm UK time.\n\nClosed on bank holidays.',
    });
  });
});

describe('decodeText', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);

  it('reads UTF-8, dropping a BOM', () => {
    const utf8 = new TextEncoder().encode('\ufeffCafé – £5');
    expect(decodeText(utf8)).toBe('Café – £5');
  });

  it('reads UTF-16 LE and BE with a BOM (Notepad / Excel "Unicode text")', () => {
    expect(decodeText(bytes(0xff, 0xfe, 0x48, 0x00, 0x69, 0x00))).toBe('Hi');
    expect(decodeText(bytes(0xfe, 0xff, 0x00, 0x48, 0x00, 0x69))).toBe('Hi');
  });

  it('falls back to Windows-1252 for legacy files instead of producing �', () => {
    // "Café £5" as Windows-1252: é = 0xE9, £ = 0xA3 — invalid as UTF-8.
    expect(decodeText(bytes(0x43, 0x61, 0x66, 0xe9, 0x20, 0xa3, 0x35))).toBe('Café £5');
  });

  it('returns null for binary data', () => {
    expect(decodeText(bytes(0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x0d))).toBeNull();
  });
});

describe('control characters', () => {
  it('normalizeText strips NUL and friends (Postgres rejects NUL)', () => {
    expect(normalizeText('a\u0000b\u0007c\u007f d')).toBe('abc d');
  });

  it('cleanPastedText keeps Markdown indentation but not control chars', () => {
    expect(cleanPastedText('- item\r\n  - nested\u0000\n\n\n\n\nend  ')).toBe(
      '- item\n  - nested\n\nend',
    );
  });
});

describe('extractText — edge cases', () => {
  it('reads a UTF-16 text file', async () => {
    const file = new File(
      [new Uint8Array([0xff, 0xfe, 0x4f, 0x00, 0x4b, 0x00])],
      'a.txt',
    );
    expect(await extractText(file)).toEqual({ ok: true, text: 'OK' });
  });

  it('rejects an empty file', async () => {
    expect(await extractText(new File([], 'a.txt'))).toEqual({
      ok: false,
      error: 'The file is empty.',
    });
  });

  it('rejects a binary file with a .txt name', async () => {
    const result = await extractText(new File([new Uint8Array([1, 0, 2, 0])], 'a.txt'));
    expect(result.ok).toBe(false);
  });

  it('rejects an HTML file with no text', async () => {
    const result = await extractText(
      new File(['<html><script>x()</script><style>a{}</style></html>'], 'a.html'),
    );
    expect(result).toEqual({ ok: false, error: 'The file has no readable text.' });
  });
});
