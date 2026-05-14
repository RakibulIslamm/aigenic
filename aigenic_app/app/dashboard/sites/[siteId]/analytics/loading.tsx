import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StatCardSkeleton } from '@/components/skeletons';

export default function AnalyticsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <Skeleton className="h-7 w-32 rounded-md" />
        <Skeleton className="h-3.5 w-96 max-w-full rounded-md" />
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </section>

      <Card className="border-border/60 bg-card/40">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-56 rounded-md" />
          <Skeleton className="h-3 w-80 max-w-full rounded-md" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[260px] w-full rounded-lg" />
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/40">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-48 rounded-md" />
          <Skeleton className="h-3 w-72 max-w-full rounded-md" />
        </CardHeader>
        <CardContent>
          <ol className="divide-y divide-border/60">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-3">
                <div className="flex flex-1 items-center gap-3">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-3.5 w-48 rounded-md" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
