'use client';

import Link from 'next/link';
import { AlertTriangle, RotateCw } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * The one styled failure card every `error.tsx` / `not-found.tsx` boundary
 * renders. Kept in one place so a Neon timeout on the dashboard and a bad
 * `siteId` in the URL look the same and always offer a way out — a retry
 * and a link back into the app.
 *
 * `digest` is Next's server-side error hash. It's the only handle a user can
 * quote that matches the `instrumentation.ts` log line, so it's shown (small,
 * muted) rather than hidden.
 */
export function ErrorState({
  title,
  description,
  digest,
  onRetry,
  retryLabel = 'Try again',
  link,
}: {
  title: string;
  description: string;
  digest?: string;
  onRetry?: () => void;
  retryLabel?: string;
  link?: { href: string; label: string };
}) {
  return (
    <Card className="mx-auto w-full max-w-lg border-border/60 bg-card/40">
      <CardHeader className="items-center text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-border/60 bg-background">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>
        <CardTitle className="font-heading text-2xl tracking-tight">{title}</CardTitle>
        <CardDescription className="max-w-md">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3 pb-8">
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <Button onClick={onRetry} size="sm" className="gap-1.5">
              <RotateCw className="h-4 w-4" />
              {retryLabel}
            </Button>
          )}
          {link && (
            <Button asChild variant="outline" size="sm">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          )}
        </div>
        {digest && (
          <p className="font-mono text-[11px] text-muted-foreground">
            Reference: {digest}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
