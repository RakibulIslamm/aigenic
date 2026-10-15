import 'server-only';
import { and, countDistinct, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { articles } from '@/db/schema';
import { chunkDocument } from '@/lib/knowledge/chunk';
import { MANUAL_CHARS_PER_SITE, MANUAL_DOCS_PER_SITE } from '@/lib/sites/limits';
import { log } from '@/lib/log';

export type StoreResult =
  { ok: true; documentId: string; parts: number } | { ok: false; error: string };

/**
 * Saves an owner-supplied document as `manual` knowledge-base rows, one per
 * chunk, all sharing a `manualDocumentId`.
 *
 * Manual rows are always served and never touched by a crawl (see
 * `lib/sites/generations.ts`), so they go live the moment this commits —
 * whatever state the site's crawl is in. `crawlGeneration` is irrelevant to
 * them and left at its default.
 *
 * The per-site document cap is checked under a per-site advisory lock in the
 * same transaction as the insert, so two uploads racing can't both see room
 * for one more.
 */
export async function storeManualDocument(input: {
  siteId: string;
  title: string;
  text: string;
}): Promise<StoreResult> {
  const chunks = chunkDocument(input.title, input.text);
  const first = chunks[0];
  if (!first) {
    return { ok: false, error: 'The document has no readable text.' };
  }
  const documentId = crypto.randomUUID();
  const addedChars = chunks.reduce((n, c) => n + c.content.length, 0);

  try {
    return await db.transaction(async (tx): Promise<StoreResult> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`manual-docs:${input.siteId}`}))`,
      );

      const [usage] = await tx
        .select({
          documents: countDistinct(articles.manualDocumentId),
          characters: sql<number>`coalesce(sum(length(${articles.content})), 0)::int`,
          // The same document added twice (a double-submitted form, the same
          // PDF picked again) would only make search return it twice.
          duplicate: sql<boolean>`coalesce(bool_or(${articles.title} = ${first.title} and ${articles.content} = ${first.content}), false)`,
        })
        .from(articles)
        .where(and(eq(articles.siteId, input.siteId), eq(articles.source, 'manual')));

      if (usage?.duplicate) {
        return { ok: false, error: 'This document is already in the knowledge base.' };
      }
      if ((usage?.documents ?? 0) >= MANUAL_DOCS_PER_SITE) {
        return {
          ok: false,
          error: `This site already has ${MANUAL_DOCS_PER_SITE} added documents — remove some before adding more.`,
        };
      }
      if ((usage?.characters ?? 0) + addedChars > MANUAL_CHARS_PER_SITE) {
        const left = Math.max(0, MANUAL_CHARS_PER_SITE - (usage?.characters ?? 0));
        return {
          ok: false,
          error: `Not enough room: this adds ${addedChars.toLocaleString('en-US')} characters but only ${left.toLocaleString('en-US')} of the site's ${MANUAL_CHARS_PER_SITE.toLocaleString('en-US')} remain. Remove some added content first.`,
        };
      }

      await tx.insert(articles).values(
        chunks.map((chunk) => ({
          siteId: input.siteId,
          source: 'manual' as const,
          manualDocumentId: documentId,
          title: chunk.title,
          content: chunk.content,
        })),
      );
      return { ok: true, documentId, parts: chunks.length };
    });
  } catch (err) {
    // The site was deleted while this was in flight: the insert's foreign key
    // fails. Anything else is infrastructure — log it, say so plainly.
    if (isForeignKeyViolation(err)) {
      return { ok: false, error: 'This site no longer exists.' };
    }
    log.error('could not store manual document', { siteId: input.siteId, err });
    return { ok: false, error: 'Could not save the document. Please try again.' };
  }
}

/** Postgres `foreign_key_violation`, wherever the driver nests it. */
function isForeignKeyViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    if ((cur as { code?: unknown }).code === '23503') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Deletes every chunk of one manual document. Returns how many rows went. */
export async function deleteManualDocument(
  siteId: string,
  documentId: string,
): Promise<number> {
  const deleted = await db
    .delete(articles)
    .where(
      and(
        eq(articles.siteId, siteId),
        eq(articles.source, 'manual'),
        eq(articles.manualDocumentId, documentId),
      ),
    )
    .returning({ id: articles.id });
  return deleted.length;
}
