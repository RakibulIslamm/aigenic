import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { StatCardSkeleton } from '@/components/skeletons';

export default function BillingLoading() {
  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-2">
        <Skeleton className="h-11 w-32 rounded-md" />
        <Skeleton className="h-3.5 w-96 max-w-full rounded-md" />
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <PlanCardSkeleton />
        <PlanCardSkeleton />
      </section>
    </div>
  );
}

function PlanCardSkeleton() {
  return (
    <Card className="flex flex-col gap-6 border-border/60 bg-card/30 p-8">
      <CardHeader className="space-y-2 p-0">
        <Skeleton className="h-3 w-12 rounded-md" />
        <div className="flex items-baseline gap-2">
          <Skeleton className="h-12 w-20 rounded-md" />
          <Skeleton className="h-3 w-16 rounded-md" />
        </div>
        <Skeleton className="h-3 w-64 max-w-full rounded-md" />
      </CardHeader>
      <Separator />
      <CardContent className="flex flex-1 flex-col gap-3 p-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-md" />
            <Skeleton className="h-3.5 w-48 max-w-full rounded-md" />
          </div>
        ))}
      </CardContent>
      <Skeleton className="h-11 w-full rounded-md" />
    </Card>
  );
}
