import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { Sparkles } from 'lucide-react';
import { TopNav } from './_components/top-nav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-foreground text-background">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-heading text-xl tracking-tight">Aigenic</span>
          </Link>
          <TopNav />
          <UserButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
