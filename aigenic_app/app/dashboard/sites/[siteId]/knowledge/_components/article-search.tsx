'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

const DEBOUNCE_MS = 250;

export function ArticleSearch({ urlQuery }: { urlQuery: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(urlQuery);
  const [prevUrlQuery, setPrevUrlQuery] = useState(urlQuery);
  const [, startTransition] = useTransition();

  // Adjust state during render when the URL changes from outside this input
  // (e.g. the "Clear search" link in the NoMatchesState). React bails out and
  // re-renders without ever flashing the stale value — no remount, no effect,
  // so the <input> keeps focus while the user types.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (urlQuery !== prevUrlQuery) {
    setPrevUrlQuery(urlQuery);
    setValue(urlQuery);
  }

  useEffect(() => {
    // No-op if the input already matches the URL — prevents the effect from
    // re-firing after we sync from an external URL change.
    if (value === urlQuery) return;

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
  }, [value, urlQuery]);

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
