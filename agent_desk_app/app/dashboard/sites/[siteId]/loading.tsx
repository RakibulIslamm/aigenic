import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ListRowSkeleton, StatCardSkeleton } from '@/components/skeletons';

/**
 * Fires while [siteId]/layout.tsx + [siteId]/page.tsx fetch in parallel —
 * i.e. the first navigation INTO a site. Once the layout resolves, tab
 * navigations within the site fall through to each tab's own loading.tsx
 * (or render directly if cached).
 */
export default function SiteOverviewLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All sites
        </Link>
      </div>

      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-56 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3.5 w-64 rounded-md" />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1 border-b border-border/60 pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      <section className="grid gap-4 pt-2 md:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </section>

      <Card className="border-border/60 bg-card/40">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-44 rounded-md" />
          <Skeleton className="h-3 w-72 rounded-md" />
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border/60">
            {Array.from({ length: 4 }).map((_, i) => (
              <ListRowSkeleton key={i} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
