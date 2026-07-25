import { describe, expect, it } from 'vitest';
import { createSiteSchema, updateSiteSchema } from '@/lib/sites/schemas';
import {
  CRAWL_MAX_PAGES_CAP,
  DEFAULT_CRAWL_MAX_PAGES,
  MIN_CRAWL_PAGES,
} from '@/lib/sites/limits';

/** The validation boundary between the dashboard forms and the database. */

const validCreate = {
  name: 'Acme',
  domain: 'https://acme.com',
  escalationEmail: 'support@acme.com',
  maxPages: 500,
};

describe('createSiteSchema', () => {
  it('accepts a well-formed site', () => {
    const parsed = createSiteSchema.parse(validCreate);
    expect(parsed.name).toBe('Acme');
    expect(parsed.maxPages).toBe(500);
  });

  it('trims the text fields', () => {
    const parsed = createSiteSchema.parse({
      ...validCreate,
      name: '  Acme  ',
      escalationEmail: '  support@acme.com  ',
    });
    expect(parsed.name).toBe('Acme');
    expect(parsed.escalationEmail).toBe('support@acme.com');
  });

  it('requires a full http(s) URL, not a bare hostname', () => {
    for (const domain of [
      'acme.com',
      'www.acme.com',
      'ftp://acme.com',
      'not a url',
      '',
    ]) {
      expect(createSiteSchema.safeParse({ ...validCreate, domain }).success, domain).toBe(
        false,
      );
    }
    for (const domain of ['http://acme.com', 'https://acme.com/help']) {
      expect(createSiteSchema.safeParse({ ...validCreate, domain }).success, domain).toBe(
        true,
      );
    }
  });

  it('rejects a domain that points somewhere private', () => {
    // Defense-in-depth against SSRF: the crawler blocks these at fetch time
    // regardless, but a site row that can never crawl shouldn't be creatable.
    // See lib/http/public-url.ts for the full matrix.
    for (const domain of [
      'http://localhost:3000/',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://metadata.internal/',
      'http://[64:ff9b::a9fe:a9fe]/', // NAT64 route to the metadata address
      // Obfuscated spellings of 127.0.0.1 — URL parsing normalizes them.
      'http://0177.0.0.1/',
      'http://2130706433/',
      'javascript:alert(1)',
    ]) {
      expect(createSiteSchema.safeParse({ ...validCreate, domain }).success, domain).toBe(
        false,
      );
    }
  });

  it('names the actual problem in the domain error', () => {
    const messageFor = (domain: string) =>
      createSiteSchema.safeParse({ ...validCreate, domain }).error?.issues[0]?.message;
    expect(messageFor('acme.com')).toMatch(/full URL/);
    expect(messageFor('http://10.0.0.5/')).toMatch(/public website/);
  });

  it('rejects a malformed escalation email', () => {
    for (const escalationEmail of ['nope', 'a@b', '@acme.com', '']) {
      expect(
        createSiteSchema.safeParse({ ...validCreate, escalationEmail }).success,
        escalationEmail,
      ).toBe(false);
    }
  });

  it('requires a non-empty name within the length cap', () => {
    expect(createSiteSchema.safeParse({ ...validCreate, name: '' }).success).toBe(false);
    expect(createSiteSchema.safeParse({ ...validCreate, name: '   ' }).success).toBe(
      false,
    );
    expect(
      createSiteSchema.safeParse({ ...validCreate, name: 'a'.repeat(100) }).success,
    ).toBe(true);
    expect(
      createSiteSchema.safeParse({ ...validCreate, name: 'a'.repeat(101) }).success,
    ).toBe(false);
  });

  describe('maxPages', () => {
    it('defaults to the shared constant when omitted', () => {
      const { maxPages, ...withoutMaxPages } = validCreate;
      void maxPages;
      expect(createSiteSchema.parse(withoutMaxPages).maxPages).toBe(
        DEFAULT_CRAWL_MAX_PAGES,
      );
    });

    it('coerces the string a form submission actually sends', () => {
      expect(createSiteSchema.parse({ ...validCreate, maxPages: '750' }).maxPages).toBe(
        750,
      );
    });

    it('enforces the shared bounds', () => {
      expect(
        createSiteSchema.safeParse({ ...validCreate, maxPages: MIN_CRAWL_PAGES }).success,
      ).toBe(true);
      expect(
        createSiteSchema.safeParse({ ...validCreate, maxPages: MIN_CRAWL_PAGES - 1 })
          .success,
      ).toBe(false);
      expect(
        createSiteSchema.safeParse({ ...validCreate, maxPages: CRAWL_MAX_PAGES_CAP })
          .success,
      ).toBe(true);
      expect(
        createSiteSchema.safeParse({ ...validCreate, maxPages: CRAWL_MAX_PAGES_CAP + 1 })
          .success,
      ).toBe(false);
    });

    it('rejects non-integers and non-numeric strings', () => {
      expect(
        createSiteSchema.safeParse({ ...validCreate, maxPages: 100.5 }).success,
      ).toBe(false);
      expect(
        createSiteSchema.safeParse({ ...validCreate, maxPages: 'lots' }).success,
      ).toBe(false);
    });
  });
});

describe('updateSiteSchema', () => {
  const validUpdate = {
    name: 'Acme',
    domain: 'https://acme.com',
    escalationEmail: 'support@acme.com',
    primaryColor: '#7c5cff',
    greeting: 'Hey! Ask me anything.',
    botName: 'Support',
  };

  it('accepts a well-formed update', () => {
    expect(updateSiteSchema.safeParse(validUpdate).success).toBe(true);
  });

  it('accepts 3- and 6-digit hex colors in either case', () => {
    for (const primaryColor of ['#fff', '#FFF', '#7c5cff', '#7C5CFF']) {
      expect(
        updateSiteSchema.safeParse({ ...validUpdate, primaryColor }).success,
        primaryColor,
      ).toBe(true);
    }
  });

  it('rejects colors that are not hex', () => {
    for (const primaryColor of ['7c5cff', '#12345', '#gggggg', 'rebeccapurple', '']) {
      expect(
        updateSiteSchema.safeParse({ ...validUpdate, primaryColor }).success,
        primaryColor,
      ).toBe(false);
    }
  });

  it('caps the greeting and bot name', () => {
    expect(
      updateSiteSchema.safeParse({ ...validUpdate, greeting: 'a'.repeat(280) }).success,
    ).toBe(true);
    expect(
      updateSiteSchema.safeParse({ ...validUpdate, greeting: 'a'.repeat(281) }).success,
    ).toBe(false);
    expect(
      updateSiteSchema.safeParse({ ...validUpdate, botName: 'a'.repeat(50) }).success,
    ).toBe(true);
    expect(
      updateSiteSchema.safeParse({ ...validUpdate, botName: 'a'.repeat(51) }).success,
    ).toBe(false);
  });

  it('applies the same public-domain check as create', () => {
    // The edit form is the other way a private target could reach the crawler.
    for (const domain of ['http://localhost/', 'http://10.0.0.5/', 'acme.com']) {
      expect(updateSiteSchema.safeParse({ ...validUpdate, domain }).success, domain).toBe(
        false,
      );
    }
    expect(
      updateSiteSchema.safeParse({ ...validUpdate, domain: 'https://acme.com/help' })
        .success,
    ).toBe(true);
  });

  it('requires non-empty greeting and bot name', () => {
    expect(updateSiteSchema.safeParse({ ...validUpdate, greeting: '  ' }).success).toBe(
      false,
    );
    expect(updateSiteSchema.safeParse({ ...validUpdate, botName: '' }).success).toBe(
      false,
    );
  });
});
