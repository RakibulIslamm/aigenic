import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { MessageBubbleSkeleton } from '@/components/skeletons';

export default function ConversationDetailLoading() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Link
            href="../"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            All conversations
          </Link>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>

        <Card className="border-border/60 bg-card/40">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-2">
              <Skeleton className="h-4 w-48 rounded-md" />
              <Skeleton className="h-3 w-32 rounded-md" />
            </div>
            <Skeleton className="h-8 w-32 rounded-md" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <MessageBubbleSkeleton align="right" />
            <MessageBubbleSkeleton align="left" />
            <MessageBubbleSkeleton align="right" />
            <MessageBubbleSkeleton align="left" />
          </CardContent>
        </Card>
      </div>

      <aside className="flex flex-col gap-4">
        <SidebarCardSkeleton rows={4} />
        <SidebarCardSkeleton rows={3} />
      </aside>
    </div>
  );
}

function SidebarCardSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="space-y-1 pb-3">
        <Skeleton className="h-4 w-24 rounded-md" />
      </CardHeader>
      <CardContent className="grid gap-2 pt-0">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Skeleton className="h-3 w-20 rounded-md" />
            <Skeleton className="h-3 w-24 rounded-md" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
