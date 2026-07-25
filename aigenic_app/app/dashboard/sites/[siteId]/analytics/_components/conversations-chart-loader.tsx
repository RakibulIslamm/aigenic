'use client';

import dynamic from 'next/dynamic';

// Pulled out into a Client Component wrapper so `next/dynamic({ ssr: false })`
// is allowed (it isn't from inside a Server Component). Defers the ~100 KB
// recharts chunk until after hydration so the analytics page paints faster.
export const ConversationsChart = dynamic(
  () =>
    import('./conversations-chart').then((mod) => ({
      default: mod.ConversationsChart,
    })),
  {
    ssr: false,
    loading: () => <div className="h-[260px] animate-pulse rounded-lg bg-card/40" />,
  },
);
