import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function KnowledgeLoading() {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44 rounded-md" />
          <Skeleton className="h-3.5 w-72 max-w-full rounded-md" />
        </div>
        <Skeleton className="h-8 w-28 rounded-md" />
      </section>

      <ul className="grid gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i}>
            <Card className="border-border/60 bg-card/40">
              <CardContent className="flex items-start justify-between gap-4 py-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-56 rounded-md" />
                  <Skeleton className="h-3 w-full max-w-md rounded-md" />
                  <Skeleton className="h-3 w-3/4 max-w-sm rounded-md" />
                </div>
                <Skeleton className="h-8 w-8 rounded-md" />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
