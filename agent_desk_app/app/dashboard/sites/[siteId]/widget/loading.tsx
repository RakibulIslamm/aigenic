import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function WidgetLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/60 bg-card/40">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-2">
            <Skeleton className="h-7 w-32 rounded-md" />
            <Skeleton className="h-3.5 w-96 max-w-full rounded-md" />
          </div>
          <Skeleton className="h-8 w-32 rounded-md" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-28 w-full rounded-lg" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-64 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/40">
        <CardHeader className="space-y-2">
          <Skeleton className="h-5 w-32 rounded-md" />
          <Skeleton className="h-3 w-80 max-w-full rounded-md" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[480px] w-full rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}
