import { describe, expect, it } from 'vitest';
import { renderRichText } from '../../widget/src/components/Message';

/**
 * The widget's inline markdown tokenizer. It regresses silently — a broken
 * URL boundary just renders a slightly wrong link, which no build or type
 * check would ever catch. The paren-balancing rule is the subtle part:
 * a trailing `)` belongs to the URL only when it closes an `(` inside it.
 */

interface Flat {
  tag: string;
  text: string;
  href?: string;
}

function flatten(nodes: ReturnType<typeof renderRichText>): Flat[] {
  return nodes.map((node) => {
    const props = node.props as { children?: unknown; href?: string };
    return {
      tag: String(node.type),
      text: props.children === undefined ? '' : String(props.children),
      ...(props.href === undefined ? {} : { href: props.href }),
    };
  });
}

/** Concatenation of every rendered node's text — nothing may be dropped. */
function visibleText(nodes: ReturnType<typeof renderRichText>): string {
  return flatten(nodes)
    .map((n) => (n.tag === 'br' ? '\n' : n.text))
    .join('');
}

describe('plain text', () => {
  it('passes through untouched', () => {
    expect(flatten(renderRichText('Hello there.'))).toEqual([
      { tag: 'span', text: 'Hello there.' },
    ]);
  });

  it('renders an empty string as nothing', () => {
    expect(flatten(renderRichText(''))).toEqual([]);
  });

  it('turns newlines into <br> without losing surrounding text', () => {
    const nodes = renderRichText('one\ntwo');
    expect(flatten(nodes).map((n) => n.tag)).toEqual(['span', 'br', 'span']);
    expect(visibleText(nodes)).toBe('one\ntwo');
  });
});

describe('markdown links', () => {
  it('renders [label](url) with the label as text', () => {
    expect(
      flatten(renderRichText('See [our pricing](https://acme.com/pricing).')),
    ).toEqual([
      { tag: 'span', text: 'See ' },
      { tag: 'a', text: 'our pricing', href: 'https://acme.com/pricing' },
      { tag: 'span', text: '.' },
    ]);
  });

  it('does not linkify a non-http scheme in link syntax', () => {
    const nodes = renderRichText('[click](javascript:alert(1))');
    expect(flatten(nodes).every((n) => n.tag !== 'a')).toBe(true);
  });
});

describe('bold', () => {
  it('renders **bold** as <strong>', () => {
    expect(flatten(renderRichText('The **Pro** plan'))).toEqual([
      { tag: 'span', text: 'The ' },
      { tag: 'strong', text: 'Pro' },
      { tag: 'span', text: ' plan' },
    ]);
  });

  it('leaves an unclosed ** as literal text', () => {
    expect(visibleText(renderRichText('2 ** 3 is not bold'))).toBe('2 ** 3 is not bold');
  });
});

describe('bare URLs', () => {
  it('auto-links a plain URL', () => {
    expect(flatten(renderRichText('Docs: https://acme.com/docs'))).toEqual([
      { tag: 'span', text: 'Docs: ' },
      { tag: 'a', text: 'https://acme.com/docs', href: 'https://acme.com/docs' },
    ]);
  });

  it.each([
    ['https://acme.com/docs.', '.'],
    ['https://acme.com/docs,', ','],
    ['https://acme.com/docs!', '!'],
    ['https://acme.com/docs?', '?'],
    ['https://acme.com/docs:', ':'],
    ['https://acme.com/docs;', ';'],
  ])('keeps trailing punctuation out of the href: %s', (input, punctuation) => {
    const nodes = flatten(renderRichText(input));
    expect(nodes[0]).toEqual({
      tag: 'a',
      text: 'https://acme.com/docs',
      href: 'https://acme.com/docs',
    });
    expect(nodes[1]).toEqual({ tag: 'span', text: punctuation });
  });

  it('drops a closing paren that does not open inside the URL', () => {
    // "(see https://acme.com/docs)" — the ')' closes the prose, not the URL.
    const nodes = flatten(renderRichText('(see https://acme.com/docs)'));
    const link = nodes.find((n) => n.tag === 'a');
    expect(link?.href).toBe('https://acme.com/docs');
    expect(visibleText(renderRichText('(see https://acme.com/docs)'))).toBe(
      '(see https://acme.com/docs)',
    );
  });

  it('keeps a closing paren that balances one inside the URL', () => {
    // Wikipedia-style URLs genuinely contain parens.
    const nodes = flatten(
      renderRichText('https://en.wikipedia.org/wiki/Foo_(bar) is the page'),
    );
    expect(nodes[0]).toEqual({
      tag: 'a',
      text: 'https://en.wikipedia.org/wiki/Foo_(bar)',
      href: 'https://en.wikipedia.org/wiki/Foo_(bar)',
    });
  });

  it('never drops characters, whatever the trailing punctuation', () => {
    for (const input of [
      'https://acme.com/a).',
      'https://acme.com/a(b).',
      'see (https://acme.com/a),',
      'https://acme.com/a!!!',
    ]) {
      expect(visibleText(renderRichText(input)), input).toBe(input);
    }
  });

  it('does not auto-link a bare hostname without a scheme', () => {
    expect(
      flatten(renderRichText('visit acme.com today')).every((n) => n.tag !== 'a'),
    ).toBe(true);
  });
});

describe('mixed content', () => {
  it('handles several token kinds on one line, in order', () => {
    const nodes = flatten(
      renderRichText(
        '**Pro** costs $49 — see [pricing](https://acme.com/p) or https://acme.com',
      ),
    );
    expect(nodes.filter((n) => n.tag === 'strong').map((n) => n.text)).toEqual(['Pro']);
    expect(nodes.filter((n) => n.tag === 'a').map((n) => n.href)).toEqual([
      'https://acme.com/p',
      'https://acme.com',
    ]);
  });

  it('handles tokens across multiple lines', () => {
    const nodes = renderRichText('**Free** plan\nSee https://acme.com/pricing');
    const flat = flatten(nodes);
    expect(flat.filter((n) => n.tag === 'br')).toHaveLength(1);
    expect(flat.find((n) => n.tag === 'a')?.href).toBe('https://acme.com/pricing');
    expect(visibleText(nodes)).toBe('Free plan\nSee https://acme.com/pricing');
  });
});
