import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { escalations, messages } from '@/db/schema';
import { ESCALATION_FROM_ADDRESS, getResendClient } from '@/lib/email/resend';
import { log } from '@/lib/log';

/**
 * How many delivery attempts one escalation gets before the retry task gives
 * up and leaves it to the dashboard's pending badge. The first attempt
 * happens in-request (the escalate tool); the rest come from the scheduled
 * `retry-escalation-emails` task.
 */
export const MAX_ESCALATION_EMAIL_ATTEMPTS = 5;

export type EscalationDeliveryResult =
  | { sent: true }
  | { sent: false; reason: 'not_found' | 'not_configured' | 'send_failed' };

/**
 * Sends (or re-sends) the owner-notification email for an escalated
 * conversation and records the outcome on the escalation row. Shared by the
 * escalate tool and the retry task so both produce the identical email and
 * identical bookkeeping.
 *
 * Two deliberate choices:
 * - Resend's SDK does **not** throw on API errors — an unverified sending
 *   domain resolves successfully with `{ error }` in the body. Success is
 *   therefore decided by the response body, never by "it didn't throw".
 * - The attempt counter is bumped *before* the send, so a crash mid-send
 *   still counts toward the bound instead of retrying forever.
 */
export async function deliverEscalationEmail(
  conversationId: string,
): Promise<EscalationDeliveryResult> {
  const escalation = await db.query.escalations.findFirst({
    where: eq(escalations.conversationId, conversationId),
    with: { conversation: { with: { site: true } } },
  });
  if (!escalation) {
    return { sent: false, reason: 'not_found' };
  }
  if (escalation.emailSentAt) {
    // Already delivered — a duplicate tool call or an overlapping retry run
    // must not email the owner twice.
    return { sent: true };
  }

  const resend = getResendClient();
  if (!resend) {
    // Nothing was tried, so no attempt is recorded — burning the bounded
    // attempts on a missing key would stop the retry task from delivering
    // once the key finally is configured.
    log.warn('Escalation email not sent — RESEND_API_KEY is not configured', {
      conversationId,
    });
    return { sent: false, reason: 'not_configured' };
  }

  const { conversation } = escalation;
  const site = conversation.site;

  const transcript = await db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: [asc(messages.createdAt)],
  });

  await db
    .update(escalations)
    .set({
      emailAttempts: sql`${escalations.emailAttempts} + 1`,
      emailLastAttemptAt: new Date(),
    })
    .where(eq(escalations.id, escalation.id));

  try {
    const result = await resend.emails.send({
      from: ESCALATION_FROM_ADDRESS,
      to: site.escalationEmail,
      replyTo: conversation.visitorEmail ?? undefined,
      subject: `[Aigenic] Escalation from ${site.name}`,
      html: renderEscalationEmail({
        siteName: site.name,
        reason: escalation.reason,
        visitorEmail: conversation.visitorEmail,
        visitorId: conversation.visitorId,
        conversationId,
        transcriptHtml: renderTranscriptHtml(
          transcript.map((m) => ({ role: m.role, content: m.content })),
        ),
      }),
    });
    if (result.error) {
      log.error('Resend rejected escalation email', {
        conversationId,
        error: result.error,
      });
      return { sent: false, reason: 'send_failed' };
    }
  } catch (err) {
    log.error('Failed to send escalation email', { err, conversationId });
    return { sent: false, reason: 'send_failed' };
  }

  await db
    .update(escalations)
    .set({ emailSentAt: new Date() })
    .where(eq(escalations.id, escalation.id));
  return { sent: true };
}

function renderTranscriptHtml(msgs: Array<{ role: string; content: string }>): string {
  return msgs
    .map((m) => {
      const who = m.role === 'assistant' ? 'Bot' : m.role === 'user' ? 'Visitor' : m.role;
      const escaped = escapeHtml(m.content);
      return `<p style="margin:0 0 12px;"><strong>${who}:</strong> ${escaped}</p>`;
    })
    .join('');
}

function renderEscalationEmail(args: {
  siteName: string;
  reason: string;
  visitorEmail: string | null;
  visitorId: string;
  conversationId: string;
  transcriptHtml: string;
}): string {
  return `<!doctype html>
<html>
  <body style="font-family: ui-sans-serif, system-ui, sans-serif; color:#18181b; max-width:640px; margin:0 auto; padding:24px;">
    <h2 style="margin:0 0 8px; font-weight:600;">New escalation from ${escapeHtml(args.siteName)}</h2>
    <p style="margin:0 0 16px; color:#71717a;">An Aigenic visitor was escalated to your team.</p>

    <div style="border:1px solid #e4e4e7; border-radius:12px; padding:16px; margin:16px 0;">
      <p style="margin:0 0 6px;"><strong>Reason:</strong> ${escapeHtml(args.reason)}</p>
      <p style="margin:0 0 6px;"><strong>Visitor email:</strong> ${args.visitorEmail ? escapeHtml(args.visitorEmail) : '<em>not provided</em>'}</p>
      <p style="margin:0;"><strong>Conversation ID:</strong> <code>${escapeHtml(args.conversationId)}</code></p>
    </div>

    <h3 style="margin:24px 0 8px; font-weight:600;">Transcript</h3>
    <div style="border:1px solid #e4e4e7; border-radius:12px; padding:16px; background:#fafafa;">
      ${args.transcriptHtml}
    </div>

    <p style="margin:24px 0 0; font-size:12px; color:#a1a1aa;">Sent by Aigenic · visitorId ${escapeHtml(args.visitorId)}</p>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
