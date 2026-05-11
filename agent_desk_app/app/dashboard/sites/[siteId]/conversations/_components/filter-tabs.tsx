'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
] as const;

export type FilterValue = (typeof FILTERS)[number]['value'];

export function FilterTabs({ counts }: { counts: Record<FilterValue, number> }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get('status') ?? 'all') as FilterValue;

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-1">
      {FILTERS.map((filter) => {
        const href = filter.value === 'all'
          ? pathname
          : `${pathname}?status=${filter.value}`;
        const active = current === filter.value;
        return (
          <Link
            key={filter.value}
            href={href}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-card hover:text-foreground'
            )}
          >
            {filter.label}
            <span
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px]',
                active
                  ? 'bg-background/20 text-background'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {counts[filter.value]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
