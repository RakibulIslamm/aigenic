import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

/**
 * Reusable skeleton primitives shaped like the live components they replace.
 * Each one is a pure server component so it renders zero JS to the client.
 */

export function StatCardSkeleton() {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-3 w-24 rounded-md" />
        <Skeleton className="h-4 w-4 rounded-md" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="mt-2 h-3 w-32 rounded-md" />
      </CardContent>
    </Card>
  );
}

export function SiteCardSkeleton() {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32 rounded-md" />
            <Skeleton className="h-3 w-40 rounded-md" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-10 rounded-md" />
            <Skeleton className="h-2.5 w-16 rounded-md" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-10 rounded-md" />
            <Skeleton className="h-2.5 w-20 rounded-md" />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ListRowSkeleton({ withAvatar = false }: { withAvatar?: boolean } = {}) {
  return (
    <li className="flex items-center gap-4 px-5 py-4">
      {withAvatar && <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />}
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-48 rounded-md" />
        <Skeleton className="h-3 w-3/4 rounded-md" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </li>
  );
}

export function MessageBubbleSkeleton({ align = 'left' }: { align?: 'left' | 'right' } = {}) {
  const isRight = align === 'right';
  return (
    <div className={isRight ? 'flex justify-end' : 'flex justify-start'}>
      <Skeleton
        className={[
          'h-12 rounded-2xl',
          isRight ? 'w-56 rounded-tr-sm' : 'w-72 rounded-tl-sm',
        ].join(' ')}
      />
    </div>
  );
}

export function FieldSkeleton({ labelWidth = 'w-24' }: { labelWidth?: string } = {}) {
  return (
    <div className="space-y-2">
      <Skeleton className={`h-3.5 ${labelWidth} rounded-md`} />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

export function HeaderSkeleton({
  titleWidth = 'w-48',
  descWidth = 'w-80',
}: {
  titleWidth?: string;
  descWidth?: string;
} = {}) {
  return (
    <div className="space-y-2">
      <Skeleton className={`h-8 ${titleWidth} rounded-md`} />
      <Skeleton className={`h-3.5 ${descWidth} rounded-md max-w-full`} />
    </div>
  );
}
