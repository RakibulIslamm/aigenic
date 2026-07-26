/**
 * HTML fragment → plain text, without JSDOM.
 *
 * Platform APIs hand back description fields as HTML (`<ul><li>…`, `<p>…`).
 * The HTML crawl path parses whole documents with JSDOM because it must also
 * find links, canonicals and article boundaries; here there is no boilerplate
 * to strip and no DOM to query — just a fragment to flatten. Constructing a
 * JSDOM per field would cost milliseconds each and we do this a thousand times
 * per crawl, so this stays regex-based on purpose.
 */

/**
 * Block-ish tags whose boundaries should become line breaks.
 *
 * Everything not listed here is inline and is removed *without* substituting a
 * space — matching how a browser renders it. Replacing inline tags with a
 * space instead turns `Writes <strong>smoothly</strong>.` into
 * "Writes smoothly ." and scatters stray spaces before punctuation through
 * every product description.
 */
const BLOCK_TAGS =
  /<\/?(?:p|div|br|hr|li|ul|ol|tr|td|th|dl|dt|dd|h[1-6]|section|article|header|footer|blockquote|figcaption|pre|table)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  trade: '™',
  reg: '®',
  copy: '©',
  deg: '°',
  eacute: 'é',
  times: '×',
  middot: '·',
  bull: '•',
};

/**
 * Flattens an HTML fragment to readable plain text.
 *
 * Order matters: scripts and styles go first (their *contents* must not
 * survive as text), then block boundaries become newlines, then the remaining
 * tags are dropped, and only then are entities decoded — decoding earlier
 * would turn `&lt;script&gt;` into a tag this function then tries to strip.
 */
export function htmlToText(html: string): string {
  if (!html) return '';

  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const withBreaks = withoutScripts.replace(BLOCK_TAGS, '\n');
  const withoutTags = withBreaks.replace(/<[^>]+>/g, '');

  return collapse(decodeEntities(withoutTags));
}

/** Decodes the named and numeric entities that actually show up in product copy. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    const body = entity as string;
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(
        isHex ? body.slice(2) : body.slice(1),
        isHex ? 16 : 10,
      );
      // Reject NaN, surrogates and out-of-range values — `fromCodePoint`
      // throws on those, and a malformed entity shouldn't kill a whole crawl.
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Collapses runs of whitespace while keeping paragraph structure: horizontal
 * whitespace becomes a single space, and runs of blank lines become one break.
 * Structure earns its keep here — an unbroken wall of text retrieves worse
 * than one where a spec list is still visibly a list.
 */
function collapse(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
