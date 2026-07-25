import { describe, expect, it } from 'vitest';
import { diffSnapshots, type CrawlSnapshot } from '@/lib/sites/crawl-events';
import { isTerminalStatus } from '@/lib/sites/status';

/**
 * The SSE stream is a diff of two snapshots — get this wrong and the activity
 * feed either goes silent mid-crawl or never stops polling. `isTerminalStatus`
 * is what tells both the server route and the client hook to close the stream.
 */

const snap = (over: Partial<CrawlSnapshot> = {}): CrawlSnapshot => ({
  status: 'crawling',
  articleCount: 0,
  lastSyncedAt: null,
  ...over,
});

describe('diffSnapshots', () => {
  it('emits nothing when nothing changed', () => {
    expect(diffSnapshots(snap(), snap())).toEqual([]);
  });

  it('emits a lifecycle event on each status transition', () => {
    const cases = [
      { to: 'pending', kind: 'queued', message: 'Queued' },
      { to: 'crawling', kind: 'crawling', message: 'Crawler started' },
      { to: 'failed', kind: 'failed', message: 'Crawl failed' },
      { to: 'stopped', kind: 'stopped', message: 'Crawl stopped' },
    ] as const;

    for (const { to, kind, message } of cases) {
      const events = diffSnapshots(snap({ status: 'pending' }), snap({ status: to }));
      if (to === 'pending') {
        // pending → pending is not a transition.
        expect(events).toEqual([]);
        continue;
      }
      expect(events, to).toHaveLength(1);
      expect(events[0]!.kind).toBe(kind);
      expect(events[0]!.message).toBe(message);
      expect(events[0]!.status).toBe(to);
    }
  });

  it('reports the indexed page count when a crawl completes', () => {
    const [event] = diffSnapshots(
      snap({ status: 'crawling', articleCount: 42 }),
      snap({ status: 'ready', articleCount: 42 }),
    );
    expect(event!.kind).toBe('complete');
    expect(event!.message).toBe('Crawl complete · 42 pages indexed');
    expect(event!.articleCount).toBe(42);
  });

  it('singularizes a one-page crawl', () => {
    const [event] = diffSnapshots(
      snap({ status: 'crawling', articleCount: 1 }),
      snap({ status: 'ready', articleCount: 1 }),
    );
    expect(event!.message).toBe('Crawl complete · 1 page indexed');
  });

  it('emits an articles event for new pages during a crawl', () => {
    const [event] = diffSnapshots(snap({ articleCount: 10 }), snap({ articleCount: 13 }));
    expect(event!.kind).toBe('articles');
    expect(event!.delta).toBe(3);
    expect(event!.message).toBe('3 pages indexed');
    expect(event!.articleCount).toBe(13);
  });

  it('singularizes a single new page', () => {
    const [event] = diffSnapshots(snap({ articleCount: 0 }), snap({ articleCount: 1 }));
    expect(event!.message).toBe('1 page indexed');
  });

  it('only counts new pages while the status is crawling', () => {
    // Articles arriving after the crawl already finished must not re-open the
    // "indexing" feed — the terminal event has already been shown.
    expect(
      diffSnapshots(
        snap({ status: 'ready', articleCount: 10 }),
        snap({ status: 'ready', articleCount: 20 }),
      ),
    ).toEqual([]);
  });

  it('ignores a negative delta (articles deleted by a KB wipe)', () => {
    expect(diffSnapshots(snap({ articleCount: 20 }), snap({ articleCount: 5 }))).toEqual(
      [],
    );
  });

  it('emits both the transition and the page delta when they land together', () => {
    const events = diffSnapshots(
      snap({ status: 'pending', articleCount: 0 }),
      snap({ status: 'crawling', articleCount: 4 }),
    );
    expect(events.map((e) => e.kind)).toEqual(['crawling', 'articles']);
  });

  it('ignores transitions to statuses with no event kind', () => {
    expect(
      diffSnapshots(snap({ status: 'crawling' }), snap({ status: 'something-new' })),
    ).toEqual([]);
  });

  it('timestamps every event', () => {
    const before = Date.now();
    const [event] = diffSnapshots(
      snap({ status: 'crawling' }),
      snap({ status: 'ready' }),
    );
    expect(event!.at).toBeGreaterThanOrEqual(before);
    expect(event!.at).toBeLessThanOrEqual(Date.now());
  });
});

describe('isTerminalStatus', () => {
  it('treats ready, failed and stopped as terminal', () => {
    expect(isTerminalStatus('ready')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('stopped')).toBe(true);
  });

  it('treats in-flight statuses as non-terminal', () => {
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('crawling')).toBe(false);
  });

  it('treats an unknown status as non-terminal rather than closing the stream', () => {
    expect(isTerminalStatus('')).toBe(false);
    expect(isTerminalStatus('READY')).toBe(false);
    expect(isTerminalStatus('whatever')).toBe(false);
  });
});
