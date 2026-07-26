import { logger } from '../logger.js';
import { fetchShopifyProducts } from './shopify.js';
import { fetchWordPressDocs } from './wordpress.js';
import type { SourceBatch, SourceContext } from './types.js';

export type { SourceBatch, SourceContext, SourceKind, StructuredDoc } from './types.js';

/**
 * Reads whatever documented data feeds the site publishes, before the HTML
 * crawl runs.
 *
 * WordPress and Shopify are probed **concurrently** — they're one cheap
 * request each and a site is essentially never both, so serializing them would
 * add a round trip to every non-WordPress crawl for nothing.
 *
 * Failure is not an error here. A site on neither platform returns an empty
 * array and the crawl proceeds exactly as it always did; this layer only ever
 * adds coverage.
 */
export async function collectStructuredDocs(ctx: SourceContext): Promise<SourceBatch[]> {
  if (ctx.maxDocs <= 0 || ctx.signal?.aborted) return [];

  const startedAt = Date.now();

  const [wordpress, shopify] = await Promise.all([
    fetchWordPressDocs(ctx).catch((err) => {
      logger.debug({ origin: ctx.origin, err: describe(err) }, 'wordpress source failed');
      return [] as SourceBatch[];
    }),
    fetchShopifyProducts(ctx).catch((err) => {
      logger.debug({ origin: ctx.origin, err: describe(err) }, 'shopify source failed');
      return [];
    }),
  ]);

  const batches: SourceBatch[] = [...wordpress];
  if (shopify.length > 0) batches.push({ kind: 'shopify', docs: shopify });

  // Both adapters were given the full budget (they ran concurrently and
  // couldn't know what the other found), so trim here rather than shipping
  // more documents than the caller asked for.
  const trimmed = capTotal(batches, ctx.maxDocs);

  const total = trimmed.reduce((n, b) => n + b.docs.length, 0);
  if (total > 0) {
    logger.info(
      {
        origin: ctx.origin,
        total,
        sources: trimmed.map((b) => `${b.kind}:${b.docs.length}`).join(','),
        durationMs: Date.now() - startedAt,
      },
      'structured sources collected',
    );
  }
  return trimmed;
}

/** Trims batches in order until their combined size fits `maxDocs`. */
function capTotal(batches: SourceBatch[], maxDocs: number): SourceBatch[] {
  const out: SourceBatch[] = [];
  let remaining = maxDocs;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const docs =
      batch.docs.length <= remaining ? batch.docs : batch.docs.slice(0, remaining);
    remaining -= docs.length;
    if (docs.length > 0) out.push({ kind: batch.kind, docs });
  }
  return out;
}

function describe(err: unknown): string {
  return err instanceof Error ? (err.message.split('\n')[0] ?? err.name) : 'unknown';
}
