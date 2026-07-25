import { describe, expect, it } from 'vitest';
import {
  decideSwap,
  generationForProgress,
  type GenerationState,
} from '@/lib/sites/generations';

/**
 * `decideSwap` is the decision that can destroy a paying customer's knowledge
 * base, so it's pure and tested exhaustively. Get it wrong in the "promote"
 * direction and a failed crawl replaces a working KB with nothing; get it wrong
 * in the "keep" direction and a good re-crawl never goes live.
 */

const site = (over: Partial<GenerationState> = {}): GenerationState => ({
  kbStatus: 'crawling',
  activeGeneration: 3,
  crawlGeneration: 4,
  ...over,
});

describe('decideSwap', () => {
  describe('superseded crawls', () => {
    it.each(['complete', 'stopped'] as const)(
      'ignores a %s from a generation we have moved past',
      (event) => {
        // The scraper aborts the old crawl when a new one starts, but its
        // in-flight webhooks still arrive. Promoting one would overwrite the
        // newer crawl with a stale partial.
        expect(
          decideSwap({
            event,
            eventGeneration: 4,
            site: site({ crawlGeneration: 5 }),
            stagedCount: 40,
            liveCount: 100,
          }),
        ).toEqual({ action: 'ignore', reason: 'superseded' });
      },
    );

    it('ignores an event from a generation older than the one being served', () => {
      expect(
        decideSwap({
          event: 'complete',
          eventGeneration: 1,
          site: site({ activeGeneration: 3, crawlGeneration: 3 }),
          stagedCount: 0,
          liveCount: 100,
        }).action,
      ).toBe('ignore');
    });
  });

  describe('a crawl that indexed nothing', () => {
    it('refuses to promote over a working KB, and reports complete as failed', () => {
      // The subtle wipe: the site starts 403ing, or robots.txt changes, and the
      // crawl "succeeds" with zero pages. Promoting empties the KB.
      expect(
        decideSwap({
          event: 'complete',
          eventGeneration: 4,
          site: site(),
          stagedCount: 0,
          liveCount: 100,
        }),
      ).toEqual({ action: 'keep', status: 'failed', reason: 'empty-crawl' });
    });

    it('reports a stopped crawl as ready — the user chose to stop', () => {
      expect(
        decideSwap({
          event: 'stopped',
          eventGeneration: 4,
          site: site(),
          stagedCount: 0,
          liveCount: 100,
        }),
      ).toEqual({ action: 'keep', status: 'ready', reason: 'empty-crawl' });
    });

    it('promotes when there is no KB to protect (a first crawl that found nothing)', () => {
      // Pre-generations behavior: `ready` with an empty KB, not a false failure.
      expect(
        decideSwap({
          event: 'complete',
          eventGeneration: 4,
          site: site(),
          stagedCount: 0,
          liveCount: 0,
        }),
      ).toEqual({ action: 'promote', generation: 4 });
    });
  });

  describe('a crawl that indexed something', () => {
    it.each(['complete', 'stopped'] as const)('promotes on %s', (event) => {
      expect(
        decideSwap({
          event,
          eventGeneration: 4,
          site: site(),
          stagedCount: 12,
          liveCount: 100,
        }),
      ).toEqual({ action: 'promote', generation: 4 });
    });

    it('promotes a partial crawl the user stopped, matching the old behavior', () => {
      // Stop has always meant "keep what you crawled". Generations made that a
      // choice rather than a side effect, and this is the choice.
      expect(
        decideSwap({
          event: 'stopped',
          eventGeneration: 4,
          site: site(),
          stagedCount: 3,
          liveCount: 500,
        }),
      ).toEqual({ action: 'promote', generation: 4 });
    });

    it('is idempotent — a redelivered complete promotes the same generation', () => {
      // After the first complete, both counters are equal; staged and live are
      // the same rows. Promoting again is a no-op, not a wipe.
      const settled = site({
        kbStatus: 'ready',
        activeGeneration: 4,
        crawlGeneration: 4,
      });
      expect(
        decideSwap({
          event: 'complete',
          eventGeneration: 4,
          site: settled,
          stagedCount: 12,
          liveCount: 12,
        }),
      ).toEqual({ action: 'promote', generation: 4 });
    });
  });
});

describe('generationForProgress', () => {
  it.each(['crawling', 'pending'])(
    'counts the staging generation while %s',
    (kbStatus) => {
      // The activity feed has to see rows landing right now — no other read path
      // is allowed to.
      expect(generationForProgress(site({ kbStatus }))).toBe(4);
    },
  );

  it.each(['ready', 'failed', 'stopped'])(
    'counts the served generation when %s',
    (kbStatus) => {
      // After a failure this reports the KB that survived, not the staging rows
      // that were just discarded.
      expect(generationForProgress(site({ kbStatus }))).toBe(3);
    },
  );

  it('is the same number either way once a crawl has been promoted', () => {
    const settled = site({ kbStatus: 'ready', activeGeneration: 4, crawlGeneration: 4 });
    expect(generationForProgress(settled)).toBe(4);
    expect(generationForProgress({ ...settled, kbStatus: 'crawling' })).toBe(4);
  });
});
