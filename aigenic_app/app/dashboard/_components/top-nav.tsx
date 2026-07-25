'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  {
    href: '/dashboard',
    label: 'Sites',
    match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/sites'),
  },
  {
    href: '/dashboard/billing',
    label: 'Billing',
    match: (p: string) => p.startsWith('/dashboard/billing'),
  },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="hidden items-center gap-1 md:flex">
      {LINKS.map((link) => {
        const active = link.match(pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-card text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
