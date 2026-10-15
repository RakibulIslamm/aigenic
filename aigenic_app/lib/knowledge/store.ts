import 'server-only';
import { and, countDistinct, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { articles } from '@/db/schema';
import { chunkDocument } from '@/lib/knowledge/chunk';
import { MANUAL_DOCS_PER_SITE } from '@/lib/sites/limits';

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
  if (chunks.length === 0) {
    return { ok: false, error: 'The document has no readable text.' };
  }
  const documentId = crypto.randomUUID();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`manual-docs:${input.siteId}`}))`,
    );

    const [existing] = await tx
      .select({ value: countDistinct(articles.manualDocumentId) })
      .from(articles)
      .where(and(eq(articles.siteId, input.siteId), eq(articles.source, 'manual')));
    if ((existing?.value ?? 0) >= MANUAL_DOCS_PER_SITE) {
      return {
        ok: false as const,
        error: `This site already has ${MANUAL_DOCS_PER_SITE} added documents — delete some before adding more.`,
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
    return { ok: true as const, documentId, parts: chunks.length };
  });
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
