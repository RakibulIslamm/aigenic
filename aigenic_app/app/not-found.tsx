import Link from 'next/link';
import { Compass } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * The app-wide 404. Also what every `notFound()` call renders — including the
 * site layout's "this siteId isn't yours / doesn't exist" path, which is the
 * most common way a real user lands here.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-16 sm:px-6">
      <Card className="mx-auto w-full max-w-lg border-border/60 bg-card/40">
        <CardHeader className="items-center text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl border border-border/60 bg-background">
            <Compass className="h-5 w-5" />
          </div>
          <CardTitle className="font-heading text-2xl tracking-tight">
            Page not found
          </CardTitle>
          <CardDescription className="max-w-md">
            This page doesn&apos;t exist, or the site you&apos;re looking for isn&apos;t
            on your account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-center gap-2 pb-8">
          <Button asChild size="sm">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Home</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
