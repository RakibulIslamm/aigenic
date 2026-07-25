import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The abuse gates on `/api/widget/chat` — the one unauthenticated endpoint
 * that spends LLM money (security plan 01 · Phase 3). Everything below the
 * route is mocked; what matters is that each gate fires BEFORE the model is
 * invoked or a message row is written, that 429s carry `Retry-After` where
 * retrying makes sense, and that a legitimate chat still flows end to end.
 */

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CONV_ID = '22222222-2222-4222-8222-222222222222';
const NEW_CONV_ID = '33333333-3333-4333-8333-333333333333';

interface GateResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}
const ALLOW: GateResult = { ok: true, remaining: 10, retryAfterSeconds: 0 };
const block = (retryAfterSeconds: number): GateResult => ({
  ok: false,
  remaining: 0,
  retryAfterSeconds,
});

/** Per-key-prefix results for the mocked limiter; unlisted keys pass. */
let gates: Record<string, GateResult>;

let siteRow:
  | {
      id: string;
      userId: string;
      name: string;
      widgetConfig: null;
      activeGeneration: number;
    }
  | undefined;
let ownerRow: { id: string; plan: string } | undefined;
let existingConversation: { id: string; siteId: string } | undefined;

let messagesInConversation: number;
let conversationsForVisitor: number;
let messagesThisMonthForSite: number;
let conversationsThisMonthForUser: number;

const inserts: Array<Record<string, unknown>> = [];

const consumeRateLimit = vi.fn(async ({ key }: { key: string }) => {
  for (const [prefix, result] of Object.entries(gates)) {
    if (key.startsWith(prefix)) return result;
  }
  return ALLOW;
});

const findSite = vi.fn(async () => siteRow);
const findOwner = vi.fn(async () => ownerRow);
const findConversation = vi.fn(async () => existingConversation);

const runSupportAgent = vi.fn(() => ({
  fullStream: (async function* () {
    yield { type: 'text-delta', text: 'Hello from the bot' };
  })(),
}));

vi.mock('@/db', () => ({
  db: {
    query: {
      sites: { findFirst: findSite },
      users: { findFirst: findOwner },
      conversations: { findFirst: findConversation },
      // `loadHistory` replays the transcript; the gates don't care what's in
      // it, only that a permitted request reaches this point at all.
      messages: { findMany: async () => [] },
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        const done = Promise.resolve();
        return Object.assign(done, {
          returning: async () => [{ id: NEW_CONV_ID }],
        });
      },
    }),
  },
}));
vi.mock('@/lib/ratelimit', () => ({
  consumeRateLimit,
  clientIp: () => '203.0.113.7',
}));
vi.mock('@/lib/sites/conversations', () => ({
  countMessagesForConversation: async () => messagesInConversation,
  countConversationsForVisitorSince: async () => conversationsForVisitor,
  countMessagesThisMonthForSite: async () => messagesThisMonthForSite,
  countConversationsThisMonthForUser: async () => conversationsThisMonthForUser,
}));
vi.mock('@/lib/agent/support-agent', () => ({ runSupportAgent }));
vi.mock('@/lib/env', () => ({ env: { OPENROUTER_API_KEY: 'test-key' } }));
vi.mock('@/lib/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { POST } = await import('@/app/api/widget/chat/route');
const { log } = await import('@/lib/log');

function post(payload: Record<string, unknown>) {
  // A plain Request is all the route touches (json + headers); the NextRequest
  // extras never come into play, and `next/server` isn't resolvable from here.
  return POST(
    new Request('http://localhost/api/widget/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }) as unknown as Parameters<typeof POST>[0],
  );
}

const basePayload = {
  siteId: SITE_ID,
  conversationId: null,
  visitorId: 'visitor-12345678',
  message: 'Hi there',
};

beforeEach(() => {
  vi.clearAllMocks();
  gates = {};
  siteRow = {
    id: SITE_ID,
    userId: 'user-1',
    name: 'Acme',
    widgetConfig: null,
    activeGeneration: 0,
  };
  ownerRow = { id: 'user-1', plan: 'free' };
  existingConversation = { id: CONV_ID, siteId: SITE_ID };
  messagesInConversation = 2;
  conversationsForVisitor = 0;
  messagesThisMonthForSite = 0;
  conversationsThisMonthForUser = 0;
  inserts.length = 0;
});

function expectNoSpend() {
  expect(runSupportAgent).not.toHaveBeenCalled();
  expect(inserts).toEqual([]);
}

describe('per-IP gates (before the body is even parsed)', () => {
  it('blocks a burst with 429 + Retry-After, before any DB lookup', async () => {
    gates['chat:ip:10s:'] = block(7);
    const res = await post(basePayload);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('7');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(findSite).not.toHaveBeenCalled();
    expectNoSpend();
  });

  it('blocks the sustained hourly limit with its own Retry-After', async () => {
    gates['chat:ip:1h:'] = block(1800);
    const res = await post(basePayload);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('1800');
    expectNoSpend();
  });
});

describe('per-site request ceiling', () => {
  it('blocks before the site row is looked up', async () => {
    gates['chat:site:1h:'] = block(600);
    const res = await post(basePayload);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
    expect(findSite).not.toHaveBeenCalled();
    expectNoSpend();
  });
});

describe('monthly per-site message budget — checked on EVERY turn', () => {
  it('hard-blocks a Free site on a REUSED conversation (the old bypass)', async () => {
    // Free budget: 30 conversations × 20 = 600 messages.
    messagesThisMonthForSite = 600;
    const res = await post({ ...basePayload, conversationId: CONV_ID });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/monthly usage limit/i);
    expectNoSpend();
  });

  it('meters (logs, does not block) a paid site over budget', async () => {
    ownerRow = { id: 'user-1', plan: 'starter' };
    // Starter budget: 300 × 20 = 6000.
    messagesThisMonthForSite = 6000;
    const res = await post({ ...basePayload, conversationId: CONV_ID });

    expect(res.status).toBe(200);
    expect(runSupportAgent).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('metered'),
      expect.objectContaining({ siteId: SITE_ID, used: 6000, budget: 6000 }),
    );
  });
});

describe('per-conversation and per-visitor caps', () => {
  it('caps a reused conversation at its message limit', async () => {
    messagesInConversation = 50;
    const res = await post({ ...basePayload, conversationId: CONV_ID });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/length limit/i);
    expectNoSpend();
  });

  it('caps how fast one visitor can mint new conversations', async () => {
    conversationsForVisitor = 5;
    const res = await post(basePayload);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/new conversations/i);
    expectNoSpend();
  });

  it('still enforces the Free plan monthly conversation cap on creation', async () => {
    conversationsThisMonthForUser = 30;
    const res = await post(basePayload);

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/monthly conversation limit/i);
    expectNoSpend();
  });

  it('still refuses a conversation belonging to another site', async () => {
    existingConversation = {
      id: CONV_ID,
      siteId: '44444444-4444-4444-8444-444444444444',
    };
    const res = await post({ ...basePayload, conversationId: CONV_ID });

    expect(res.status).toBe(403);
    expectNoSpend();
  });
});

describe('a legitimate chat still flows', () => {
  it('creates a conversation, streams, and persists both messages', async () => {
    const res = await post(basePayload);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');

    const text = await new Response(res.body).text();
    expect(text).toContain(NEW_CONV_ID);
    expect(text).toContain('Hello from the bot');

    expect(runSupportAgent).toHaveBeenCalledTimes(1);
    // conversation row + user message + assistant message
    expect(inserts).toHaveLength(3);
    expect(inserts[1]).toMatchObject({ role: 'user', content: 'Hi there' });
    expect(inserts[2]).toMatchObject({ role: 'assistant' });
  });

  it('runs every gate against the limiter with namespaced keys', async () => {
    await post(basePayload);
    const keys = consumeRateLimit.mock.calls.map(([{ key }]: [{ key: string }]) => key);
    expect(keys).toEqual([
      'chat:ip:10s:203.0.113.7',
      'chat:ip:1h:203.0.113.7',
      `chat:site:1h:${SITE_ID}`,
    ]);
  });
});
