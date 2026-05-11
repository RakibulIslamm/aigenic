'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface TabNavProps {
  siteId: string;
}

const TABS = [
  { label: 'Overview', href: '' },
  { label: 'Knowledge base', href: '/knowledge' },
  { label: 'Widget code', href: '/widget' },
  { label: 'Conversations', href: '/conversations' },
  { label: 'Settings', href: '/settings' },
];

export function TabNav({ siteId }: TabNavProps) {
  const pathname = usePathname();
  const base = `/dashboard/sites/${siteId}`;

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-border/60">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const isActive = tab.href === '' ? pathname === href : pathname === href;
        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              'relative px-3 py-2.5 text-sm transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
            {isActive && (
              <span className="absolute inset-x-3 bottom-[-1px] h-[2px] rounded-full bg-foreground" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
