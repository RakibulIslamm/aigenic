'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  rotateCrawlAccessKeyAction,
  testCrawlerAccessAction,
  type AccessTestState,
} from '@/app/dashboard/actions';
import { CopyButton } from './copy-button';

/**
 * How an owner lets our crawler through their own firewall: one rule that
 * matches this site's access key. Lives in Settings, and the "your firewall
 * blocked us" panel links here.
 */
export function CrawlerAccessCard({
  siteId,
  accessKey,
  header,
  ruleExpression,
  crawlerIp,
  docsPath,
}: {
  siteId: string;
  accessKey: string;
  header: string;
  ruleExpression: string;
  crawlerIp: string | null;
  docsPath: string;
}) {
  return (
    <Card id="crawler-access" className="scroll-mt-24 border-border/60 bg-card/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Crawler access
        </CardTitle>
        <CardDescription>
          If Cloudflare or another firewall blocks our crawler, add one rule that lets
          through requests carrying this site&apos;s private access key. Only our crawler
          sends it, so the rule doesn&apos;t open your site to anyone else.{' '}
          <Link
            href={docsPath}
            target="_blank"
            className="text-foreground underline underline-offset-2"
          >
            About our crawler
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyRow label="Header name" value={header} />
          <CopyRow label="Access key" value={accessKey} />
        </div>

        <div className="rounded-lg border border-border/60 bg-background/50 p-4 text-sm">
          <p className="mb-2 font-medium">On Cloudflare</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>
              Open your domain → <span className="text-foreground">Security → WAF</span> →{' '}
              <span className="text-foreground">Custom rules</span> →{' '}
              <span className="text-foreground">Create rule</span>.
            </li>
            <li>
              Name it <span className="text-foreground">Allow Aigenic crawler</span>,
              click <span className="text-foreground">Edit expression</span> and paste:
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                <code className="block min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs text-foreground">
                  {ruleExpression}
                </code>
                <CopyButton value={ruleExpression} label="Copy rule" />
              </div>
            </li>
            <li>
              Action: <span className="text-foreground">Skip</span>. Tick{' '}
              <span className="text-foreground">All Super Bot Fight Mode rules</span>,{' '}
              <span className="text-foreground">All managed rules</span> and{' '}
              <span className="text-foreground">All rate limiting rules</span>, and under
              &ldquo;More components to skip&rdquo; tick{' '}
              <span className="text-foreground">Browser Integrity Check</span> and{' '}
              <span className="text-foreground">Security Level</span>. Deploy, and drag
              the rule to the top of the list.
            </li>
            <li>
              Press <span className="text-foreground">Test access</span> below, then{' '}
              <span className="text-foreground">Resync all</span> on the Knowledge tab.
            </li>
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            On Cloudflare&apos;s Free plan, the simple{' '}
            <span className="text-foreground">Bot Fight Mode</span> switch ignores custom
            rules. If the test still fails, turn it off under Security → Bots, or add your
            content directly on the Knowledge tab instead.
          </p>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/50 p-4 text-sm">
          <p className="mb-2 font-medium">Other firewalls and security plugins</p>
          <p className="text-muted-foreground">
            Sucuri, Wordfence, AWS WAF, Vercel Firewall, Akamai and others: add an allow
            rule for requests whose <span className="text-foreground">{header}</span>{' '}
            header equals the access key above
            {crawlerIp ? (
              <>
                , or allow our crawler&apos;s IP address{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                  {crawlerIp}
                </code>
              </>
            ) : null}
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TestAccessButton siteId={siteId} />
          <RotateKeyButton siteId={siteId} />
        </div>
      </CardContent>
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function TestAccessButton({ siteId }: { siteId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AccessTestState | null>(null);

  return (
    <div className="flex w-full flex-col gap-3">
      <div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              try {
                setResult(await testCrawlerAccessAction(siteId));
              } catch {
                setResult({ ok: false, error: 'The test could not run. Try again.' });
              }
            });
          }}
        >
          {pending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="mr-1 h-4 w-4" />
          )}
          Test access
        </Button>
      </div>
      {result && !pending && <AccessResult result={result} />}
    </div>
  );
}

function AccessResult({ result }: { result: AccessTestState }) {
  if (!result.ok) {
    return <ResultLine ok={false} text={result.error} />;
  }
  const probe = result.result;
  if (probe.ok) {
    return (
      <ResultLine
        ok
        text={`Our crawler got through (HTTP ${probe.status}). Run "Resync all" on the Knowledge tab to rebuild your knowledge base.`}
      />
    );
  }
  const text =
    probe.code === 'blocked'
      ? `Still blocked (${probe.detail}). Check the rule is deployed, is first in the list, and skips bot protection — Cloudflare can take a minute to apply changes.`
      : probe.code === 'unreachable'
        ? `We couldn't reach your site (${probe.detail}). Check the site URL in Settings above and that the site is online.`
        : `Your site answered ${probe.detail} — check the site URL in Settings above points at a live page.`;
  return <ResultLine ok={false} text={text} />;
}

function ResultLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
        ok
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
          : 'border-red-500/30 bg-red-500/5 text-red-500'
      }`}
    >
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{text}</span>
    </p>
  );
}

function RotateKeyButton({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-muted-foreground">
          <KeyRound className="mr-1 h-4 w-4" />
          Generate new key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a new access key?</DialogTitle>
          <DialogDescription>
            Do this if the key was shared somewhere it shouldn&apos;t be. The current key
            stops working immediately — you&apos;ll need to update your firewall rule with
            the new one before the next crawl.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await rotateCrawlAccessKeyAction(siteId);
                if (result.ok) {
                  toast.success(result.message ?? 'New access key issued');
                  setOpen(false);
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            {pending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Generate new key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
