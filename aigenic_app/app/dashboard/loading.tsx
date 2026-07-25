import { Skeleton } from '@/components/ui/skeleton';
import { SiteCardSkeleton, StatCardSkeleton } from '@/components/skeletons';

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24 rounded-md" />
          <Skeleton className="h-11 w-48 rounded-md" />
          <Skeleton className="h-3.5 w-96 max-w-full rounded-md" />
        </div>
        <Skeleton className="h-11 w-32 rounded-md" />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SiteCardSkeleton key={i} />
        ))}
      </section>
    </div>
  );
}
