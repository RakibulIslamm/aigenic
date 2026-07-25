import { logger, schedules } from '@trigger.dev/sdk/v3';
import { and, asc, count, gte, isNull, lt } from 'drizzle-orm';
import { db } from '@/db';
import { escalations } from '@/db/schema';
import {
  deliverEscalationEmail,
  MAX_ESCALATION_EMAIL_ATTEMPTS,
} from '@/lib/email/escalation';

/** How many pending escalations one run works through. */
const RETRY_BATCH_SIZE = 50;

/**
 * Rows younger than this are left alone — their in-request first attempt
 * (or a previous run's send) may still be in flight, and racing it could
 * email the owner twice.
 */
const MIN_AGE_MS = 5 * 60 * 1000;

/**
 * Redelivers escalation emails that never made it out: Resend key missing at
 * the time, the API rejected the send (unverified domain), or the process
 * died mid-request. Without this, the only trace of a dropped escalation is
 * `email_sent_at IS NULL` — the visitor was told a human is coming and
 * nobody was ever notified.
 *
 * Attempts are bounded per row (`MAX_ESCALATION_EMAIL_ATTEMPTS`); rows that
 * exhaust them stay visible in the dashboard's pending-escalations badge
 * rather than being retried forever.
 */
export const retryEscalationsTask = schedules.task({
  id: 'retry-escalation-emails',
  cron: { pattern: '*/10 * * * *', timezone: 'UTC' },
  maxDuration: 300,
  run: async (payload) => {
    const now = new Date(payload.timestamp);
    const cutoff = new Date(now.getTime() - MIN_AGE_MS);

    const pending = await db.query.escalations.findMany({
      where: and(
        isNull(escalations.emailSentAt),
        lt(escalations.emailAttempts, MAX_ESCALATION_EMAIL_ATTEMPTS),
        lt(escalations.createdAt, cutoff),
      ),
      orderBy: [asc(escalations.createdAt)],
      limit: RETRY_BATCH_SIZE,
    });

    let delivered = 0;
    let failed = 0;

    // Sequential on purpose: Resend rate-limits per second, and a batch of
    // 50 fired in parallel would trade one failure mode for another.
    for (const row of pending) {
      const result = await deliverEscalationEmail(row.conversationId);
      if (result.sent) {
        delivered += 1;
        continue;
      }
      failed += 1;
      if (result.reason === 'not_configured') {
        // Every remaining row would fail the same way — stop instead of
        // logging the same warning fifty times.
        logger.warn(
          'RESEND_API_KEY is not configured — leaving pending escalations for a later run',
        );
        break;
      }
    }

    // Rows past the attempt bound are no longer retried; the owner sees them
    // only via the dashboard badge. Worth a loud line here so a persistent
    // failure (e.g. unverified sending domain) shows up in task logs too.
    const [exhausted] = await db
      .select({ value: count() })
      .from(escalations)
      .where(
        and(
          isNull(escalations.emailSentAt),
          gte(escalations.emailAttempts, MAX_ESCALATION_EMAIL_ATTEMPTS),
        ),
      );
    const exhaustedCount = Number(exhausted?.value ?? 0);
    if (exhaustedCount > 0) {
      logger.warn(
        `${exhaustedCount} escalation email(s) exhausted their ${MAX_ESCALATION_EMAIL_ATTEMPTS} attempts — check the Resend sending domain/key`,
      );
    }

    if (pending.length > 0) {
      logger.log(
        `Escalation email retry: ${delivered} delivered, ${failed} still pending of ${pending.length} due`,
      );
    }

    return {
      scheduledAt: payload.timestamp,
      due: pending.length,
      delivered,
      failed,
      exhausted: exhaustedCount,
    };
  },
});
