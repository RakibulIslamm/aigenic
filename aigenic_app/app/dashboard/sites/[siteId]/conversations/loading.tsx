import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { ListRowSkeleton } from '@/components/skeletons';

export default function ConversationsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44 rounded-md" />
          <Skeleton className="h-3.5 w-80 max-w-full rounded-md" />
        </div>
        <div className="flex gap-1 rounded-lg border border-border/60 bg-card/40 p-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-md" />
          ))}
        </div>
      </header>

      <Card className="border-border/60 bg-card/40">
        <CardContent className="p-0">
          <ul className="divide-y divide-border/60">
            {Array.from({ length: 6 }).map((_, i) => (
              <ListRowSkeleton key={i} withAvatar />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
