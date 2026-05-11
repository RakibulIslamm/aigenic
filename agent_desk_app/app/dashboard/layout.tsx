import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { Sparkles } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-background">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-serif text-xl tracking-tight">AgentDesk</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <Link href="/dashboard" className="transition hover:text-foreground">
              Sites
            </Link>
            <span className="cursor-not-allowed opacity-50" title="Coming in Phase 4">
              Conversations
            </span>
            <span className="cursor-not-allowed opacity-50" title="Coming in Phase 5">
              Analytics
            </span>
            <span className="cursor-not-allowed opacity-50" title="Coming in Phase 6">
              Billing
            </span>
          </nav>
          <UserButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
    </div>
  );
}
