import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from '../../vps-scraper/src/sources/html-text.js';

/**
 * Platform APIs return description fields as HTML. This flattener runs once
 * per document — a thousand times on a catalogue site — so it is regex-based
 * rather than DOM-based, which makes its edge cases worth pinning down.
 */

describe('htmlToText', () => {
  it('flattens a product description to readable text', () => {
    const html = '<p>A <strong>great</strong> pen.</p><p>Ships in 2 days.</p>';
    expect(htmlToText(html)).toBe('A great pen.\nShips in 2 days.');
  });

  it('keeps list items on separate lines so a spec list still reads as a list', () => {
    const html = '<ul><li>160 pieces</li><li>Aluminium case</li></ul>';
    expect(htmlToText(html)).toBe('160 pieces\nAluminium case');
  });

  it('drops script and style CONTENT, not just their tags', () => {
    const html =
      '<p>Buy</p><script>var price = 9.99;</script><style>.a{color:red}</style>';
    const text = htmlToText(html);
    expect(text).toBe('Buy');
    expect(text).not.toContain('9.99');
    expect(text).not.toContain('color');
  });

  it('strips HTML comments', () => {
    expect(htmlToText('<p>Hi</p><!-- internal note: reprice -->')).toBe('Hi');
  });

  it('decodes entities AFTER stripping tags, so escaped markup stays text', () => {
    // Decoding first would produce a literal <b> that tag-stripping then ate.
    expect(htmlToText('<p>Use &lt;b&gt; for bold</p>')).toBe('Use <b> for bold');
  });

  it('collapses whitespace but preserves paragraph breaks', () => {
    expect(htmlToText('<p>a</p>\n\n\n<p>b</p>')).toBe('a\nb');
    expect(htmlToText('<p>lots     of      space</p>')).toBe('lots of space');
  });

  it('handles the empty and tagless cases', () => {
    expect(htmlToText('')).toBe('');
    expect(htmlToText('plain text')).toBe('plain text');
  });

  it('does not hang or throw on malformed markup', () => {
    expect(() => htmlToText('<p>unclosed <div><span>')).not.toThrow();
    expect(htmlToText('<<>><p>ok</p>')).toContain('ok');
  });
});

describe('decodeEntities', () => {
  it('decodes the named entities that show up in product copy', () => {
    expect(decodeEntities('Art &amp; Craft')).toBe('Art & Craft');
    expect(decodeEntities('caf&eacute;')).toBe('café');
    expect(decodeEntities('5&nbsp;kg')).toBe('5 kg');
    expect(decodeEntities('&ldquo;quoted&rdquo;')).toBe('“quoted”');
  });

  it('decodes decimal and hex numeric entities, including non-Latin scripts', () => {
    expect(decodeEntities('&#2547;')).toBe('৳'); // Bengali taka sign
    expect(decodeEntities('&#x9F3;')).toBe('৳');
    expect(decodeEntities('&#128512;')).toBe('😀'); // above the BMP
  });

  it('leaves malformed or out-of-range entities alone instead of throwing', () => {
    // fromCodePoint would throw on a lone surrogate or an out-of-range value;
    // one bad entity in one product must not fail a whole crawl.
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;');
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;');
    expect(decodeEntities('100% & rising')).toBe('100% & rising');
  });
});
