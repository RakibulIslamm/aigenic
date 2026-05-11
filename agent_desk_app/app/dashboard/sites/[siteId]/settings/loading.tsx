import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { FieldSkeleton } from '@/components/skeletons';

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <Skeleton className="h-7 w-32 rounded-md" />
        <Skeleton className="h-3.5 w-96 max-w-full rounded-md" />
      </header>

      <FieldGroupSkeleton fieldCount={3} />
      <FieldGroupSkeleton fieldCount={3} />

      <div className="flex justify-end">
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader className="space-y-2">
          <Skeleton className="h-4 w-28 rounded-md" />
          <Skeleton className="h-3 w-80 max-w-full rounded-md" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-9 w-32 rounded-md" />
        </CardContent>
      </Card>
    </div>
  );
}

function FieldGroupSkeleton({ fieldCount }: { fieldCount: number }) {
  return (
    <section className="grid gap-4 rounded-xl border border-border/60 bg-card/40 p-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="h-3 w-72 max-w-full rounded-md" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: fieldCount }).map((_, i) => (
          <FieldSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}
