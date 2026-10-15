import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The dashboard's "Add content" actions. Every way an upload can go wrong has
 * to come back as a message the dialog can show next to the file — a throw
 * here would crash the page into its error boundary instead.
 */

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

let siteRow:
  { id: string; userId: string; domain: string; crawlAccessKey: string } | undefined;
const storeManualDocument = vi.fn();
const deleteManualDocument = vi.fn();
const probeSiteAccess = vi.fn();

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/auth/user', () => ({
  getOrCreateUser: async () => ({ id: 'user-1', plan: 'free' }),
  requireUserId: async () => 'user-1',
}));
vi.mock('@/lib/env', () => ({
  isScraperConfigured: () => true,
  isTriggerConfigured: () => true,
  env: {},
}));
vi.mock('@/lib/trigger/config', () => ({ ensureTriggerConfigured: () => {} }));
vi.mock('@trigger.dev/sdk/v3', () => ({ runs: { cancel: vi.fn() } }));
vi.mock('@/lib/scraper/client', () => ({
  startSiteCrawl: vi.fn(),
  stopSiteCrawl: vi.fn(),
  probeSiteAccess,
}));
vi.mock('@/lib/sites/queries', () => ({ getSiteForUser: async () => siteRow }));
vi.mock('@/lib/sites/enqueue-crawl', () => ({ enqueueSiteCrawl: vi.fn() }));
vi.mock('@/lib/sites/crawl-runs', () => ({
  claimManualCrawlSlot: vi.fn(),
  deleteCrawlRun: vi.fn(),
}));
vi.mock('@/lib/ratelimit', () => ({
  consumeRateLimit: async () => ({ ok: true, remaining: 9, retryAfterSeconds: 0 }),
}));
vi.mock('@/lib/knowledge/store', () => ({ storeManualDocument, deleteManualDocument }));

const {
  addTextDocumentAction,
  deleteManualDocumentAction,
  testCrawlerAccessAction,
  uploadDocumentAction,
} = await import('@/app/dashboard/actions');

const upload = (file: File | string) => {
  const fd = new FormData();
  fd.set('file', file);
  return uploadDocumentAction(SITE_ID, fd);
};

beforeEach(() => {
  vi.clearAllMocks();
  siteRow = {
    id: SITE_ID,
    userId: 'user-1',
    domain: 'https://acme.com',
    crawlAccessKey: 'a'.repeat(32),
  };
  storeManualDocument.mockResolvedValue({ ok: true, documentId: DOC_ID, parts: 1 });
});

describe('uploadDocumentAction', () => {
  it('stores a text file, titled from its name', async () => {
    const result = await upload(
      new File(['Returns are free within 30 days.'], 'returns_policy-v2.md'),
    );
    expect(result).toMatchObject({ ok: true, message: 'Added returns_policy-v2.md' });
    expect(storeManualDocument).toHaveBeenCalledWith({
      siteId: SITE_ID,
      title: 'returns policy v2',
      text: 'Returns are free within 30 days.',
    });
  });

  it.each([
    ['a missing file field', 'not-a-file', /choose a file/i],
    ['an empty file', new File([], 'empty.txt'), /empty/i],
    ['an unsupported type', new File(['x'], 'photo.png'), /unsupported file type/i],
    [
      'a binary file renamed .txt',
      new File([new Uint8Array([0x50, 0x4b, 0, 0, 1])], 'a.txt'),
      /doesn't look like a text file/i,
    ],
    [
      'a corrupt PDF',
      new File(['%PDF-nope'], 'broken.pdf'),
      /damaged or password-protected/i,
    ],
  ])('refuses %s with a message, storing nothing', async (_label, file, message) => {
    const result = await upload(file);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(message);
    expect(storeManualDocument).not.toHaveBeenCalled();
  });

  it('refuses an oversized file before reading it', async () => {
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'huge.txt');
    const result = await upload(big);
    expect(!result.ok && result.error).toMatch(/over 4 MB/);
    expect(storeManualDocument).not.toHaveBeenCalled();
  });

  it("passes the store's refusal through, naming the file", async () => {
    storeManualDocument.mockResolvedValue({
      ok: false,
      error: 'This document is already in the knowledge base.',
    });
    const result = await upload(new File(['Some text here.'], 'faq.txt'));
    expect(result).toEqual({
      ok: false,
      error: 'faq.txt: This document is already in the knowledge base.',
    });
  });

  it('turns an unexpected failure into a message instead of throwing', async () => {
    storeManualDocument.mockRejectedValue(new Error('connection reset'));
    const result = await upload(new File(['Some text here.'], 'faq.txt'));
    expect(result).toEqual({
      ok: false,
      error: 'faq.txt: could not be added. Please try again.',
    });
  });

  it('falls back to a placeholder title when the name has none', async () => {
    await upload(new File(['Some text here.'], '___.txt'));
    expect(storeManualDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Untitled document' }),
    );
  });

  it("won't touch someone else's site", async () => {
    siteRow = undefined;
    expect(await upload(new File(['x'], 'a.txt'))).toEqual({
      ok: false,
      error: 'Site not found',
    });
  });
});

describe('addTextDocumentAction', () => {
  const submit = (title: string, content: string) => {
    const fd = new FormData();
    fd.set('title', title);
    fd.set('content', content);
    return addTextDocumentAction(SITE_ID, undefined, fd);
  };

  it('stores pasted text with control characters stripped', async () => {
    const result = await submit(
      'Shipping\u0000',
      'We ship worldwide\u0000 within 5 days.\r\n\r\n\r\n\r\nFree over $50.',
    );
    expect(result.ok).toBe(true);
    expect(storeManualDocument).toHaveBeenCalledWith({
      siteId: SITE_ID,
      title: 'Shipping',
      text: 'We ship worldwide within 5 days.\n\nFree over $50.',
    });
  });

  it('flags fields, keeping what was typed', async () => {
    const result = await submit('', 'too short');
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { title: expect.any(String), content: expect.any(String) },
      values: { title: '', content: 'too short' },
    });
    expect(storeManualDocument).not.toHaveBeenCalled();
  });

  it('rejects text that is only padding once cleaned', async () => {
    const result = await submit('Title', `${'\u0001'.repeat(30)}hi`);
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { content: expect.any(String) },
    });
  });

  it('keeps the typed values when saving fails unexpectedly', async () => {
    storeManualDocument.mockRejectedValue(new Error('db down'));
    const result = await submit('Hours', 'We are open nine to five on weekdays.');
    expect(result).toMatchObject({
      ok: false,
      values: { title: 'Hours', content: 'We are open nine to five on weekdays.' },
    });
  });
});

describe('deleteManualDocumentAction', () => {
  it('rejects a malformed id without querying', async () => {
    expect(await deleteManualDocumentAction(SITE_ID, 'nope')).toMatchObject({
      ok: false,
    });
    expect(deleteManualDocument).not.toHaveBeenCalled();
  });

  it('treats an already-removed document as done', async () => {
    deleteManualDocument.mockResolvedValue(0);
    expect(await deleteManualDocumentAction(SITE_ID, DOC_ID)).toMatchObject({
      ok: true,
      message: 'Document was already removed',
    });
  });

  it('reports a failure instead of throwing', async () => {
    deleteManualDocument.mockRejectedValue(new Error('db down'));
    expect(await deleteManualDocumentAction(SITE_ID, DOC_ID)).toMatchObject({
      ok: false,
    });
  });
});

describe('testCrawlerAccessAction', () => {
  it('returns the probe result', async () => {
    probeSiteAccess.mockResolvedValue({ ok: true, result: { ok: true, status: 200 } });
    expect(await testCrawlerAccessAction(SITE_ID)).toEqual({
      ok: true,
      result: { ok: true, status: 200 },
    });
    expect(probeSiteAccess).toHaveBeenCalledWith('https://acme.com', 'a'.repeat(32));
  });

  it('explains an out-of-date crawler service', async () => {
    probeSiteAccess.mockResolvedValue({ ok: false, reason: 'outdated' });
    const result = await testCrawlerAccessAction(SITE_ID);
    expect(!result.ok && result.error).toMatch(/needs an update/);
  });

  it('reports an unreachable crawler service', async () => {
    probeSiteAccess.mockResolvedValue({ ok: false, reason: 'unreachable' });
    const result = await testCrawlerAccessAction(SITE_ID);
    expect(!result.ok && result.error).toMatch(/could not reach/i);
  });
});
