'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

const DEBOUNCE_MS = 250;

/**
 * The parent passes a `key={defaultValue}` so a URL-driven change (e.g. the
 * "Clear search" link in the NoMatchesState) remounts this component with the
 * fresh initial value — avoiding the setState-in-effect pattern.
 */
export function ArticleSearch({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(defaultValue);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const trimmed = value.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      // A new query invalidates any old page number; reset to page 1.
      params.delete('page');
      const next = params.toString();
      const target = next ? `${pathname}?${next}` : pathname;
      startTransition(() => router.replace(target, { scroll: false }));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search pages by title…"
        aria-label="Search knowledge base"
        className="pl-9 pr-9"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
