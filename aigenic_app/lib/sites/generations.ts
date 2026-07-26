import { and, eq, type SQL } from 'drizzle-orm';
import { articles } from '@/db/schema';

/**
 * Crawl generations — how a re-crawl replaces a knowledge base without ever
 * leaving it empty.
 *
 * The old dispatch sequence was `DELETE articles` → `POST /crawl`. If the POST
 * failed — VPS down, DNS, timeout — the working KB was *already gone* and the
 * widget answered from nothing. That path also runs from the 03:00 UTC cron, so
 * a routine VPS blip silently wiped every customer's KB overnight.
 *
 * Now every article row records the crawl that produced it, and a site tracks
 * two counters:
 *
 * - `sites.activeGeneration` — the generation the KB **serves**. Every read
 *   path filters to it, so an in-flight crawl is invisible to visitors and to
 *   the dashboard.
 * - `sites.crawlGeneration` — the generation being **written**. Bumped on every
 *   dispatch, which is what makes a superseded crawl's late webhooks
 *   identifiable and therefore ignorable.
 *
 * The two are equal when nothing is in flight. Only a successful terminal event
 * moves `activeGeneration` up to meet `crawlGeneration` and deletes what the
 * previous generation left behind. A failed, empty or superseded crawl changes
 * nothing a visitor can see.
 *
 * **The invariant everything else relies on:** rows where
 * `crawl_generation = sites.active_generation` are the live KB. Everything else
 * is staging or garbage, is never read, and is cleared on the next dispatch —
 * so the system self-heals even if a crawl dies without any terminal event.
 */

/**
 * Restricts a query to one site's articles from one generation. Use it
 * everywhere articles are read — a missed call means a visitor can be answered
 * out of a half-finished crawl.
 *
 * The generation is a parameter rather than a subquery on `sites` because every
 * caller already holds the site row (the dashboard through the request-memoized
 * `getSiteForUser`, the chat route through its own lookup), so there's no round
 * trip to save. It also has to be: Drizzle's relational query builder rewrites
 * table qualifiers inside a raw `sql` template to the alias of the table being
 * queried, which silently turned `sites.active_generation` into
 * `articles.active_generation` — valid-looking SQL that Postgres rejects.
 *
 * Pass `activeGeneration` for anything a visitor or owner reads, and
 * `crawlGeneration` only to report the progress of a crawl in flight.
 */
export function articlesInGeneration(
  siteId: string,
  generation: number,
): SQL | undefined {
  return and(eq(articles.siteId, siteId), eq(articles.crawlGeneration, generation));
}

/**
 * The generation to *count* for a site: the one being written while a crawl is
 * in flight (so progress is visible), the one being served otherwise (so a
 * failed crawl reports the KB that survived, not the staging rows just thrown
 * away). Only for progress reporting — never for reading article content.
 */
export function generationForProgress(site: GenerationState): number {
  const inFlight = site.kbStatus === 'crawling' || site.kbStatus === 'pending';
  return inFlight ? site.crawlGeneration : site.activeGeneration;
}

/** The subset of a site row the generation decisions need. */
export interface GenerationState {
  kbStatus: string;
  activeGeneration: number;
  crawlGeneration: number;
}

export type SwapDecision =
  /** Not the crawl we're waiting on — a newer dispatch has superseded it. */
  | { action: 'ignore'; reason: 'superseded' }
  /** Make the crawled generation live and delete everything else. */
  | { action: 'promote'; generation: number }
  /** Keep the current KB; the crawl produced nothing worth swapping in. */
  | { action: 'keep'; status: 'ready' | 'failed'; reason: 'empty-crawl' };

/**
 * What a `complete` / `stopped` webhook should do to the knowledge base.
 *
 * Pure on purpose: this is the decision that can destroy a paying customer's
 * data, and it should be provable without a database.
 *
 * `stagedCount` is how many articles the finished crawl actually indexed;
 * `liveCount` is how many the site is serving right now.
 */
export function decideSwap(input: {
  event: 'complete' | 'stopped';
  eventGeneration: number;
  site: GenerationState;
  stagedCount: number;
  liveCount: number;
}): SwapDecision {
  const { event, eventGeneration, site, stagedCount, liveCount } = input;

  // A crawl that was aborted and re-dispatched still has webhooks in flight.
  // Its `complete` must not promote a generation we've moved on from, or a
  // stale partial crawl overwrites a newer full one.
  if (eventGeneration !== site.crawlGeneration) {
    return { action: 'ignore', reason: 'superseded' };
  }

  // An empty crawl is NEVER promoted. Two flavors:
  // - With a live KB: promoting would wipe it — the subtle data loss
  //   generations exist to prevent. Keep the KB; `complete` is a real failure
  //   the owner must see, `stopped` was their own click, so it stays `ready`.
  // - Without one (a first crawl that found nothing): there is no data to
  //   lose, but promoting used to mark the site `ready` with an EMPTY
  //   knowledge base — a lie that hid firewall blocks (Cloudflare 403s)
  //   behind a green badge. An empty first crawl is a failure, full stop.
  if (stagedCount === 0) {
    return {
      action: 'keep',
      status: event === 'stopped' && liveCount > 0 ? 'ready' : 'failed',
      reason: 'empty-crawl',
    };
  }

  return { action: 'promote', generation: eventGeneration };
}
