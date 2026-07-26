import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Structured-source adapters, with the network stubbed at the `fetchJson`
 * boundary. Everything below the stub (safeFetch, size caps, JSON parsing) is
 * covered by the SSRF-guard suite; what matters here is the mapping from a
 * platform's payload to the documents we put in a knowledge base — and the
 * budget/robots rules that decide which of them survive.
 */

vi.mock('../../vps-scraper/src/sources/http.js', () => ({
  fetchJson: vi.fn(),
}));

const { fetchJson } = await import('../../vps-scraper/src/sources/http.js');
const { fetchShopifyProducts } = await import('../../vps-scraper/src/sources/shopify.js');
const { fetchWordPressDocs } = await import('../../vps-scraper/src/sources/wordpress.js');

const mockFetchJson = vi.mocked(fetchJson);

/**
 * Replies keyed by a substring of the requested URL; anything else is a 404.
 *
 * Longest match wins, which matters more than it looks: every WordPress URL
 * contains `/wp-json/`, so a first-match rule would answer the products
 * request with the namespace listing and quietly make the API look empty.
 */
function respondWith(
  routes: Array<[match: string, data: unknown, headers?: Record<string, string>]>,
) {
  const ordered = [...routes].sort((a, b) => b[0].length - a[0].length);
  mockFetchJson.mockImplementation(async ({ url }) => {
    for (const [match, data, headers] of ordered) {
      if (url.includes(match)) {
        return { data, header: (name: string) => headers?.[name.toLowerCase()] ?? null };
      }
    }
    return null;
  });
}

function ctx(overrides: Partial<Parameters<typeof fetchShopifyProducts>[0]> = {}) {
  return {
    origin: 'https://shop.example.com',
    userAgent: 'AigenicBot/1.0',
    extraHeaders: {},
    maxDocs: 1000,
    isEndpointAllowed: () => true,
    isDocumentAllowed: () => true,
    signal: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  mockFetchJson.mockReset();
});

describe('shopify', () => {
  const product = {
    title: 'Blue Pen',
    handle: 'blue-pen',
    body_html: '<p>Writes <strong>smoothly</strong>.</p>',
    vendor: 'Acme',
    product_type: 'Stationery',
    tags: ['office', 'pens'],
    variants: [{ price: '12.50', available: true }],
  };

  it('maps a product to a citable page URL and readable text', async () => {
    respondWith([['/products.json', { products: [product] }]]);

    const [doc] = await fetchShopifyProducts(ctx());

    expect(doc?.url).toBe('https://shop.example.com/products/blue-pen');
    expect(doc?.title).toBe('Blue Pen');
    expect(doc?.content).toContain('Product: Blue Pen');
    expect(doc?.content).toContain('Brand: Acme');
    expect(doc?.content).toContain('Category: Stationery');
    expect(doc?.content).toContain('Tags: office, pens');
    expect(doc?.content).toContain('Price: 12.50');
    expect(doc?.content).toContain('Availability: in stock');
    expect(doc?.content).toContain('Writes smoothly.');
  });

  it('states a price range when variants disagree', async () => {
    respondWith([
      [
        '/products.json',
        {
          products: [
            { ...product, variants: [{ price: '10' }, { price: '25' }, { price: '18' }] },
          ],
        },
      ],
    ]);
    const [doc] = await fetchShopifyProducts(ctx());
    expect(doc?.content).toContain('Price: 10 – 25');
  });

  it('omits availability entirely when the API never reports it', async () => {
    respondWith([
      ['/products.json', { products: [{ ...product, variants: [{ price: '10' }] }] }],
    ]);
    const [doc] = await fetchShopifyProducts(ctx());
    expect(doc?.content).not.toContain('Availability');
  });

  it('returns nothing for a site that is not Shopify', async () => {
    mockFetchJson.mockResolvedValue(null);
    expect(await fetchShopifyProducts(ctx())).toEqual([]);
  });

  it('skips products missing a title or handle rather than emitting a broken URL', async () => {
    respondWith([
      [
        '/products.json',
        { products: [{ title: 'No handle' }, { handle: 'no-title' }, product] },
      ],
    ]);
    const docs = await fetchShopifyProducts(ctx());
    expect(docs).toHaveLength(1);
    expect(docs[0]?.url).toBe('https://shop.example.com/products/blue-pen');
  });

  it('stops at maxDocs even when the feed has more', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      ...product,
      title: `Pen ${i}`,
      handle: `pen-${i}`,
    }));
    respondWith([['/products.json', { products: many }]]);

    const docs = await fetchShopifyProducts(ctx({ maxDocs: 7 }));
    expect(docs).toHaveLength(7);
  });

  it('never requests the feed when robots.txt disallows it', async () => {
    respondWith([['/products.json', { products: [product] }]]);
    const docs = await fetchShopifyProducts(ctx({ isEndpointAllowed: () => false }));
    expect(docs).toEqual([]);
    expect(mockFetchJson).not.toHaveBeenCalled();
  });

  it('drops products whose page URL the frontier policy would refuse', async () => {
    respondWith([['/products.json', { products: [product] }]]);
    const docs = await fetchShopifyProducts(ctx({ isDocumentAllowed: () => false }));
    expect(docs).toEqual([]);
  });

  it('stops paginating on a short page', async () => {
    respondWith([['/products.json', { products: [product] }]]);
    await fetchShopifyProducts(ctx());
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
  });
});

describe('wordpress / woocommerce', () => {
  const wooProduct = {
    name: 'Kuromi Art Set',
    permalink: 'https://shop.example.com/product/kuromi-art-set/',
    sku: 'ART-160',
    short_description: '<ul><li>160 pieces</li></ul>',
    description: '<p>A big set.</p>',
    prices: {
      price: '275000',
      regular_price: '355000',
      currency_code: 'BDT',
      currency_symbol: '৳ ',
      currency_minor_unit: 2,
    },
    categories: [{ name: 'Art Sets' }],
    is_in_stock: true,
    average_rating: '4.5',
    review_count: 12,
  };

  it('converts minor-unit prices to real money', async () => {
    // The API sends "275000" with minor_unit 2. Quoting that verbatim would
    // tell a customer a price one hundred times too high.
    respondWith([
      ['/wp-json/', { namespaces: ['wp/v2', 'wc/store/v1'] }],
      ['wc/store/v1/products', [wooProduct]],
    ]);

    const batches = await fetchWordPressDocs(ctx());
    const doc = batches.find((b) => b.kind === 'woocommerce')?.docs[0];

    expect(doc?.content).toContain('Price: ৳2750.00 (was ৳3550.00)');
    expect(doc?.content).not.toContain('275000');
  });

  it('only calls it a discount when the regular price is genuinely higher', async () => {
    respondWith([
      ['/wp-json/', { namespaces: ['wc/store/v1'] }],
      [
        'wc/store/v1/products',
        [
          {
            ...wooProduct,
            prices: { ...wooProduct.prices, price: '355000', regular_price: '355000' },
          },
        ],
      ],
    ]);
    const doc = (await fetchWordPressDocs(ctx()))[0]?.docs[0];
    expect(doc?.content).toContain('Price: ৳3550.00');
    expect(doc?.content).not.toContain('was');
  });

  it('carries the fields a support bot gets asked about', async () => {
    respondWith([
      ['/wp-json/', { namespaces: ['wc/store/v1'] }],
      ['wc/store/v1/products', [wooProduct]],
    ]);
    const doc = (await fetchWordPressDocs(ctx()))[0]?.docs[0];

    expect(doc?.url).toBe('https://shop.example.com/product/kuromi-art-set/');
    expect(doc?.title).toBe('Kuromi Art Set');
    expect(doc?.content).toContain('Category: Art Sets');
    expect(doc?.content).toContain('SKU: ART-160');
    expect(doc?.content).toContain('Availability: in stock');
    expect(doc?.content).toContain('Rating: 4.5 (12 reviews)');
    expect(doc?.content).toContain('160 pieces');
    expect(doc?.content).toContain('A big set.');
  });

  it('reads core pages and posts, citing their permalinks', async () => {
    respondWith([
      ['/wp-json/', { namespaces: ['wp/v2'] }],
      [
        'wp/v2/pages',
        [
          {
            link: 'https://shop.example.com/delivery-policy/',
            title: { rendered: 'Delivery policy' },
            content: { rendered: '<p>We deliver in 3 days.</p>' },
          },
        ],
      ],
    ]);

    const docs = (await fetchWordPressDocs(ctx())).flatMap((b) => b.docs);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.url).toBe('https://shop.example.com/delivery-policy/');
    expect(docs[0]?.title).toBe('Delivery policy');
    expect(docs[0]?.content).toContain('We deliver in 3 days.');
  });

  it('does not repeat the title when the content already opens with it', async () => {
    respondWith([
      ['/wp-json/', { namespaces: ['wp/v2'] }],
      [
        'wp/v2/pages',
        [
          {
            link: 'https://shop.example.com/delivery-policy/',
            title: { rendered: 'Delivery policy' },
            content: { rendered: '<h1>Delivery policy</h1><p>Dhaka: 70 BDT.</p>' },
          },
        ],
      ],
    ]);
    const doc = (await fetchWordPressDocs(ctx())).flatMap((b) => b.docs)[0];
    expect(doc?.content.match(/Delivery policy/g)).toHaveLength(1);
  });

  it('falls back to the excerpt when a page has no rendered content', async () => {
    respondWith([
      ['/wp-json/', { namespaces: ['wp/v2'] }],
      [
        'wp/v2/pages',
        [
          {
            link: 'https://shop.example.com/about/',
            title: { rendered: 'About' },
            content: { rendered: '' },
            excerpt: { rendered: '<p>Since 2019.</p>' },
          },
        ],
      ],
    ]);
    const docs = (await fetchWordPressDocs(ctx())).flatMap((b) => b.docs);
    expect(docs[0]?.content).toContain('Since 2019.');
  });

  it('returns nothing for a site that is not WordPress', async () => {
    mockFetchJson.mockResolvedValue(null);
    expect(await fetchWordPressDocs(ctx())).toEqual([]);
  });

  it('skips WooCommerce entirely when the store namespace is absent', async () => {
    respondWith([
      ['/wp-json/', { namespaces: ['wp/v2'] }],
      ['wp/v2/pages', []],
    ]);
    await fetchWordPressDocs(ctx());
    const requested = mockFetchJson.mock.calls.map(([c]) => c.url);
    expect(requested.some((u) => u.includes('wc/store'))).toBe(false);
  });

  /** 100 products and one policy page — the shape that motivated the reserve. */
  function catalogueRoutes(pageCount = 1) {
    const products = Array.from({ length: 100 }, (_, i) => ({
      ...wooProduct,
      name: `P${i}`,
      permalink: `https://shop.example.com/product/p${i}/`,
    }));
    const pages = Array.from({ length: pageCount }, (_, i) => ({
      link: `https://shop.example.com/policy-${i}/`,
      title: { rendered: `Policy ${i}` },
      content: { rendered: '<p>Terms apply.</p>' },
    }));
    return [
      ['/wp-json/', { namespaces: ['wp/v2', 'wc/store/v1'] }],
      ['wc/store/v1/products', products],
      ['wp/v2/pages', pages],
      ['wp/v2/posts', []],
    ] as Array<[string, unknown, Record<string, string>?]>;
  }

  it('holds slots back for policy pages so the catalogue cannot crowd them out', async () => {
    // The bug this prevents: a 1,000-product shop consuming the whole budget,
    // leaving the Delivery/Returns pages — which most support questions are
    // actually about — entirely unread.
    respondWith(catalogueRoutes(3));

    const batches = await fetchWordPressDocs(ctx({ maxDocs: 20 }));
    const products = batches.find((b) => b.kind === 'woocommerce')?.docs ?? [];
    const pages = batches.find((b) => b.kind === 'wordpress')?.docs ?? [];

    expect(products).toHaveLength(17); // 20 − floor(20 × 0.15)
    expect(pages).toHaveLength(3);
    expect(products.length + pages.length).toBeLessThanOrEqual(20);
  });

  it('gives the whole budget to pages when there is no shop to compete', async () => {
    respondWith([
      ['/wp-json/', { namespaces: ['wp/v2'] }],
      [
        'wp/v2/pages',
        Array.from({ length: 10 }, (_, i) => ({
          link: `https://shop.example.com/p-${i}/`,
          title: { rendered: `P${i}` },
          content: { rendered: '<p>x</p>' },
        })),
      ],
      ['wp/v2/posts', []],
    ]);

    const docs = (await fetchWordPressDocs(ctx({ maxDocs: 10 }))).flatMap((b) => b.docs);
    expect(docs).toHaveLength(10);
  });

  it('never exceeds maxDocs, even when the reserve rounds to zero', async () => {
    respondWith(catalogueRoutes(3));
    const batches = await fetchWordPressDocs(ctx({ maxDocs: 5 }));
    const total = batches.reduce((n, b) => n + b.docs.length, 0);
    expect(total).toBeLessThanOrEqual(5);
  });

  it('stops paginating when X-WP-TotalPages says it is the last page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      ...wooProduct,
      name: `P${i}`,
      permalink: `https://shop.example.com/product/p${i}/`,
    }));
    respondWith([
      ['/wp-json/', { namespaces: ['wc/store/v1'] }],
      ['wc/store/v1/products', full, { 'x-wp-totalpages': '1' }],
    ]);

    await fetchWordPressDocs(ctx());
    const productCalls = mockFetchJson.mock.calls.filter(([c]) =>
      c.url.includes('wc/store/v1/products'),
    );
    expect(productCalls).toHaveLength(1);
  });

  it('never touches the API when robots.txt disallows /wp-json/', async () => {
    respondWith([['/wp-json/', { namespaces: ['wp/v2'] }]]);
    expect(await fetchWordPressDocs(ctx({ isEndpointAllowed: () => false }))).toEqual([]);
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});
