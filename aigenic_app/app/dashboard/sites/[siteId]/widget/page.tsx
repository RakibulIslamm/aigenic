import { notFound } from 'next/navigation';
import { Code2 } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser } from '@/lib/sites/queries';
import { env } from '@/lib/env';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '../_components/copy-button';

export default async function WidgetPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const widgetUrl = env.widgetUrl;
  const snippet = `<script
  src="${widgetUrl}/widget.js"
  data-site="${site.id}"
  async
></script>`;

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/60 bg-card/40">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="font-heading text-2xl tracking-tight">
              Embed code
            </CardTitle>
            <CardDescription>
              Paste this before{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">&lt;/body&gt;</code>{' '}
              on every page you want the chat bubble to appear.
            </CardDescription>
          </div>
          <CopyButton value={snippet} label="Copy snippet" />
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg border border-border/60 bg-background p-4 font-mono text-sm leading-relaxed">
            {snippet}
          </pre>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="rounded-full">
              <Code2 className="mr-1 h-3 w-3" />
              site id
            </Badge>
            <code className="rounded bg-muted px-1.5 py-0.5">{site.id}</code>
            <CopyButton value={site.id} label="Copy id" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/40">
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <CardDescription>
            Sanity-check the bubble loads. The iframe injects the same script you&apos;d
            ship to production.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-border/60 bg-background">
            <iframe
              title="Aigenic widget preview"
              srcDoc={previewHtml(site.id, widgetUrl)}
              className="h-[480px] w-full"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Loaded from{' '}
            <code className="rounded bg-muted px-1 py-0.5">{widgetUrl}/widget.js</code>.
            The bubble mounts in a Shadow DOM so your host page&apos;s CSS can&apos;t
            reach inside.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function previewHtml(siteId: string, widgetUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #fafafa; color: #18181b; padding: 32px; }
      .card { max-width: 520px; margin: 40px auto; padding: 28px; border-radius: 16px; background: #fff; border: 1px solid #e4e4e7; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
      h2 { margin: 0 0 8px; font-size: 18px; }
      p { margin: 0; color: #71717a; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h2>Your site (preview)</h2>
      <p>The Aigenic chat bubble mounts in the bottom-right corner. Click it to open the widget.</p>
    </div>
    <script src="${widgetUrl}/widget.js" data-site="${siteId}" async></script>
  </body>
</html>`;
}
