import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractText,
  htmlToText,
  kindForFileName,
  normalizeText,
} from '@/lib/knowledge/extract';

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

  it.each(['photo.png', 'old.doc', 'archive.zip', 'noextension'])(
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
