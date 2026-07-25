import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The escalate_to_human tool's control flow. What must hold:
 *
 * - Status flip + escalation insert are one transaction; the returning()
 *   length decides whether THIS call created the row.
 * - The email goes out only for a fresh insert — a duplicate call never
 *   emails the owner twice.
 * - The message handed back to the model is honest: a confirmed delivery may
 *   promise human follow-up; anything else only claims the request is logged.
 */

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

let siteRow: { id: string; name: string; escalationEmail: string } | undefined;
let insertReturning: Array<{ id: string }>;
let conversationUpdates: Array<Record<string, unknown>>;

const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          conversationUpdates.push(values);
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => insertReturning,
        }),
      }),
    }),
  };
  return fn(tx);
});

vi.mock('@/db', () => ({
  db: {
    query: { sites: { findFirst: async () => siteRow } },
    transaction,
  },
}));

const deliverEscalationEmail = vi.fn();
vi.mock('@/lib/email/escalation', () => ({
  deliverEscalationEmail,
  MAX_ESCALATION_EMAIL_ATTEMPTS: 5,
}));

const { buildSupportTools } = await import('@/lib/agent/tools');

interface EscalateResult {
  ok: boolean;
  emailSent?: boolean;
  alreadyEscalated?: boolean;
  message: string;
}

async function escalate(input: {
  reason: string;
  visitorEmail?: string;
}): Promise<EscalateResult> {
  const tools = buildSupportTools({
    siteId: SITE_ID,
    conversationId: CONVERSATION_ID,
    visitorId: 'v-1',
    activeGeneration: 0,
  });
  // execute's return type is a union with the streaming AsyncIterable shape;
  // this tool always resolves to a plain object.
  return (await tools.escalate_to_human.execute!(input, {
    toolCallId: 'call-1',
    messages: [],
  })) as EscalateResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  siteRow = { id: SITE_ID, name: 'Acme', escalationEmail: 'owner@acme.com' };
  insertReturning = [{ id: 'esc-1' }];
  conversationUpdates = [];
  deliverEscalationEmail.mockResolvedValue({ sent: true });
});

it('fails cleanly when the site row is gone', async () => {
  siteRow = undefined;
  const res = await escalate({ reason: 'Visitor wants a refund' });
  expect(res.ok).toBe(false);
  expect(transaction).not.toHaveBeenCalled();
  expect(deliverEscalationEmail).not.toHaveBeenCalled();
});

describe('fresh escalation', () => {
  it('flips status, records the visitor email, and delivers once', async () => {
    const res = await escalate({
      reason: 'Visitor wants a refund',
      visitorEmail: 'visitor@example.com',
    });
    expect(res).toMatchObject({ ok: true, emailSent: true });
    expect(conversationUpdates).toEqual([
      { status: 'escalated', visitorEmail: 'visitor@example.com' },
    ]);
    expect(deliverEscalationEmail).toHaveBeenCalledExactlyOnceWith(CONVERSATION_ID);
  });

  it('does not overwrite the visitor email when none was captured', async () => {
    await escalate({ reason: 'Visitor wants a refund' });
    expect(conversationUpdates).toEqual([{ status: 'escalated' }]);
  });

  it('promises follow-up only when delivery is confirmed', async () => {
    const res = await escalate({ reason: 'Visitor wants a refund' });
    expect(res.ok && res.message).toMatch(/follow up/i);
  });

  it('says only "logged" when the email did not go out', async () => {
    deliverEscalationEmail.mockResolvedValue({ sent: false, reason: 'send_failed' });
    const res = await escalate({ reason: 'Visitor wants a refund' });
    expect(res).toMatchObject({ ok: true, emailSent: false });
    expect(res.ok && res.message).toMatch(/logged/i);
    expect(res.ok && res.message).not.toMatch(/follow up|shortly/i);
  });
});

describe('repeat escalation of the same conversation', () => {
  it('never emails twice and tells the model it is already escalated', async () => {
    insertReturning = [];
    const res = await escalate({ reason: 'Visitor wants a refund' });
    expect(res).toMatchObject({ ok: true, emailSent: false, alreadyEscalated: true });
    expect(deliverEscalationEmail).not.toHaveBeenCalled();
  });
});
