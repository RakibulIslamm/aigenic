import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The escalation email delivery helper. The trap this guards: Resend's SDK
 * does NOT throw on API errors — an unverified sending domain resolves
 * successfully with `{ error }` in the body — so "it didn't throw" must never
 * be what sets `emailSentAt`. And the attempt counter has to reflect real
 * sends only, or a missing API key would burn the retry budget before the
 * key is even configured.
 */

const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

function makeEscalation(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    conversationId: CONVERSATION_ID,
    reason: 'Visitor asked for a refund',
    emailSentAt: null as Date | null,
    emailAttempts: 0,
    emailLastAttemptAt: null as Date | null,
    createdAt: new Date('2026-07-25T00:00:00Z'),
    conversation: {
      id: CONVERSATION_ID,
      visitorEmail: 'visitor@example.com' as string | null,
      visitorId: 'v-1',
      site: { name: 'Acme', escalationEmail: 'owner@acme.com' },
    },
    ...overrides,
  };
}

let escalationRow: ReturnType<typeof makeEscalation> | undefined;
let updates: Array<Record<string, unknown>>;

vi.mock('@/db', () => ({
  db: {
    query: {
      escalations: { findFirst: async () => escalationRow },
      messages: {
        findMany: async () => [
          { role: 'user', content: 'I want a refund' },
          { role: 'assistant', content: 'Let me get a human' },
        ],
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
  },
}));

const sendMock = vi.fn();
let resendClient: { emails: { send: typeof sendMock } } | null;

vi.mock('@/lib/email/resend', () => ({
  getResendClient: () => resendClient,
  ESCALATION_FROM_ADDRESS: 'Aigenic <agent@test.dev>',
}));

const { deliverEscalationEmail, MAX_ESCALATION_EMAIL_ATTEMPTS } =
  await import('@/lib/email/escalation');

/** The two row-updates the helper can issue, told apart by their keys. */
const attemptUpdates = () => updates.filter((u) => 'emailAttempts' in u);
const sentUpdates = () => updates.filter((u) => 'emailSentAt' in u);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  escalationRow = makeEscalation();
  updates = [];
  resendClient = { emails: { send: sendMock } };
  sendMock.mockResolvedValue({ data: { id: 'email-1' }, error: null });
});

it('exposes a sane retry bound', () => {
  expect(MAX_ESCALATION_EMAIL_ATTEMPTS).toBeGreaterThan(1);
});

describe('short-circuits — no send, no bookkeeping', () => {
  it('reports not_found when there is no escalation row', async () => {
    escalationRow = undefined;
    const res = await deliverEscalationEmail(CONVERSATION_ID);
    expect(res).toEqual({ sent: false, reason: 'not_found' });
    expect(sendMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('treats an already-delivered escalation as sent without re-emailing', async () => {
    escalationRow = makeEscalation({ emailSentAt: new Date() });
    const res = await deliverEscalationEmail(CONVERSATION_ID);
    expect(res).toEqual({ sent: true });
    expect(sendMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('does not burn an attempt when Resend is not configured', async () => {
    resendClient = null;
    const res = await deliverEscalationEmail(CONVERSATION_ID);
    expect(res).toEqual({ sent: false, reason: 'not_configured' });
    expect(attemptUpdates()).toHaveLength(0);
    expect(sentUpdates()).toHaveLength(0);
  });
});

describe('real sends — attempt is counted before the outcome is known', () => {
  it('records the attempt and marks sent on success', async () => {
    const res = await deliverEscalationEmail(CONVERSATION_ID);
    expect(res).toEqual({ sent: true });
    expect(attemptUpdates()).toHaveLength(1);
    expect(sentUpdates()).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledOnce();
    const payload = sendMock.mock.calls[0]?.[0];
    expect(payload?.to).toBe('owner@acme.com');
    expect(payload?.replyTo).toBe('visitor@example.com');
    expect(payload?.subject).toContain('Acme');
  });

  it('a Resend API error body is a failed send, not a success', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'domain not verified' },
    });
    const res = await deliverEscalationEmail(CONVERSATION_ID);
    expect(res).toEqual({ sent: false, reason: 'send_failed' });
    expect(attemptUpdates()).toHaveLength(1);
    expect(sentUpdates()).toHaveLength(0);
  });

  it('a thrown network error is a failed send with the attempt still counted', async () => {
    sendMock.mockRejectedValue(new Error('ECONNRESET'));
    const res = await deliverEscalationEmail(CONVERSATION_ID);
    expect(res).toEqual({ sent: false, reason: 'send_failed' });
    expect(attemptUpdates()).toHaveLength(1);
    expect(sentUpdates()).toHaveLength(0);
  });
});
