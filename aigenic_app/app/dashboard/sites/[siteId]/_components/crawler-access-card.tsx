'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Wifi,
  X,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  rescrapeSiteAction,
  rotateCrawlAccessKeyAction,
  testCrawlerAccessAction,
  type AccessTestState,
} from '@/app/dashboard/actions';
import { guideForProvider, type Guide } from '@/lib/sites/crawler-identity';

/**
 * Crawler access — how an owner lets our crawler past their own firewall.
 *
 * Built as check → fix → verify, because most owners don't know what sits in
 * front of their site, and a wall of instructions for the wrong firewall is
 * worse than none:
 *
 * 1. **Check.** One request from the crawler itself. If it gets in, the owner
 *    is done; if not, the response names the blocker (Cloudflare, Vercel…)
 *    and the matching guide opens.
 * 2. **Fix.** One action per step, every value copyable where it's needed,
 *    a done-tick per step (remembered per browser), and Cloudflare's Skip
 *    tick-boxes shown as a ✓/✗ list — the step people get wrong.
 * 3. **Verify.** The same check, then "Resync now" right there.
 */

const RULE_NAME = 'Allow Aigenic crawler';

type CheckState =
  { phase: 'idle' } | { phase: 'checking' } | { phase: 'done'; result: AccessTestState };

export function CrawlerAccessCard({
  siteId,
  siteHost,
  accessKey,
  header,
  ruleExpression,
  crawlerIp,
  docsPath,
  lastCrawlBlocked,
  initialGuide,
}: {
  siteId: string;
  siteHost: string;
  accessKey: string;
  header: string;
  ruleExpression: string;
  crawlerIp: string | null;
  docsPath: string;
  /** The last crawl failed with a `blocked` verdict. */
  lastCrawlBlocked: boolean;
  /** Guide to open first — from the service named in the last crawl error. */
  initialGuide: Guide;
}) {
  const [check, setCheck] = useState<CheckState>({ phase: 'idle' });
  const [guide, setGuide] = useState<Guide>(initialGuide);
  const [checking, startCheck] = useTransition();

  function runCheck() {
    setCheck({ phase: 'checking' });
    startCheck(async () => {
      let result: AccessTestState;
      try {
        result = await testCrawlerAccessAction(siteId);
      } catch {
        result = {
          ok: false,
          error: 'Could not reach the server — check your connection and try again.',
        };
      }
      setCheck({ phase: 'done', result });
      // Open the guide for whatever answered, so the owner never reads the
      // Cloudflare steps for a site that's on Vercel.
      if (result.ok && result.result.provider) {
        setGuide(guideForProvider(result.result.provider));
      }
    });
  }

  const passed = check.phase === 'done' && check.result.ok && check.result.result.ok;

  return (
    <Card id="crawler-access" className="scroll-mt-24 border-border/60 bg-card/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Crawler access
        </CardTitle>
        <CardDescription>
          Some sites sit behind a firewall that blocks bots — including ours. Check
          whether we can reach <span className="text-foreground">{siteHost}</span>, and if
          not, add one rule that lets in only our crawler. About two minutes.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <StatusPanel
          siteId={siteId}
          siteHost={siteHost}
          check={check}
          checking={checking}
          lastCrawlBlocked={lastCrawlBlocked}
          onCheck={runCheck}
        />

        {!passed && (
          <section aria-labelledby="crawler-access-guide" className="flex flex-col gap-4">
            <div>
              <h3 id="crawler-access-guide" className="text-sm font-medium">
                Let our crawler in
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pick where your site is protected. Not sure? Press{' '}
                <span className="text-foreground">Check access</span> and we&apos;ll tell
                you.
              </p>
            </div>

            <Tabs value={guide} onValueChange={(v) => setGuide(v as Guide)}>
              <TabsList className="grid h-auto! w-full grid-cols-3">
                <TabsTrigger value="cloudflare" className="py-1.5">
                  Cloudflare
                </TabsTrigger>
                <TabsTrigger value="vercel" className="py-1.5">
                  Vercel
                </TabsTrigger>
                <TabsTrigger value="other" className="py-1.5">
                  Other
                </TabsTrigger>
              </TabsList>

              <TabsContent value="cloudflare" className="pt-4">
                <CloudflareGuide
                  siteId={siteId}
                  siteHost={siteHost}
                  ruleExpression={ruleExpression}
                  checking={checking}
                  onCheck={runCheck}
                />
              </TabsContent>
              <TabsContent value="vercel" className="pt-4">
                <VercelGuide
                  siteId={siteId}
                  header={header}
                  accessKey={accessKey}
                  checking={checking}
                  onCheck={runCheck}
                />
              </TabsContent>
              <TabsContent value="other" className="pt-4">
                <OtherGuide
                  siteId={siteId}
                  header={header}
                  accessKey={accessKey}
                  crawlerIp={crawlerIp}
                  checking={checking}
                  onCheck={runCheck}
                />
              </TabsContent>
            </Tabs>
          </section>
        )}

        <AdvancedSection
          siteId={siteId}
          header={header}
          accessKey={accessKey}
          crawlerIp={crawlerIp}
          docsPath={docsPath}
        />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ status */

function StatusPanel({
  siteId,
  siteHost,
  check,
  checking,
  lastCrawlBlocked,
  onCheck,
}: {
  siteId: string;
  siteHost: string;
  check: CheckState;
  checking: boolean;
  lastCrawlBlocked: boolean;
  onCheck: () => void;
}) {
  const view = statusView(check, siteHost, lastCrawlBlocked);
  const Icon = view.icon;
  const passed = check.phase === 'done' && check.result.ok && check.result.result.ok;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center',
        TONES[view.tone].box,
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-full',
            TONES[view.tone].icon,
          )}
        >
          <Icon
            className={cn('h-4.5 w-4.5', check.phase === 'checking' && 'animate-spin')}
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{view.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{view.body}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {passed && <ResyncButton siteId={siteId} />}
        <Button
          size="sm"
          variant={passed ? 'outline' : 'default'}
          onClick={onCheck}
          disabled={checking}
        >
          {checking ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Wifi className="mr-1 h-4 w-4" />
          )}
          {check.phase === 'idle' ? 'Check access' : 'Check again'}
        </Button>
      </div>
    </div>
  );
}

type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, { box: string; icon: string }> = {
  neutral: { box: 'border-border/60 bg-background/50', icon: 'bg-muted text-foreground' },
  progress: {
    box: 'border-border/60 bg-background/50',
    icon: 'bg-muted text-foreground',
  },
  success: {
    box: 'border-emerald-500/30 bg-emerald-500/5',
    icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    box: 'border-amber-500/30 bg-amber-500/5',
    icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  danger: { box: 'border-red-500/30 bg-red-500/5', icon: 'bg-red-500/15 text-red-500' },
};

function statusView(
  check: CheckState,
  host: string,
  lastCrawlBlocked: boolean,
): { tone: Tone; icon: typeof ShieldCheck; title: string; body: string } {
  if (check.phase === 'checking') {
    return {
      tone: 'progress',
      icon: Loader2,
      title: `Checking ${host}…`,
      body: 'Sending one request from our crawler, exactly as a crawl would.',
    };
  }
  if (check.phase === 'idle') {
    return lastCrawlBlocked
      ? {
          tone: 'warning',
          icon: ShieldAlert,
          title: 'Your last crawl was blocked',
          body: 'Follow the steps below, then check access to confirm the fix worked.',
        }
      : {
          tone: 'neutral',
          icon: ShieldQuestion,
          title: 'Not checked yet',
          body: `See whether our crawler can reach ${host}. Takes a few seconds.`,
        };
  }

  const { result } = check;
  if (!result.ok) {
    return {
      tone: 'danger',
      icon: AlertTriangle,
      title: 'Check failed',
      body: result.error,
    };
  }
  const probe = result.result;
  const behind = probe.provider ? ` (behind ${probe.provider})` : '';
  if (probe.ok) {
    return {
      tone: 'success',
      icon: CheckCircle2,
      title: `Our crawler can reach ${host}${behind}`,
      body: 'Nothing else to set up. Resync to rebuild your knowledge base.',
    };
  }
  switch (probe.code) {
    case 'blocked':
      return {
        tone: 'danger',
        icon: ShieldAlert,
        title: probe.provider
          ? `Blocked by ${probe.provider}`
          : 'Blocked by your site’s security',
        body: probe.provider
          ? `Follow the ${probe.provider} steps below, then check again. Changes can take a minute to apply.`
          : 'A firewall, security plugin or your host is blocking us. Follow the "Other" steps below, then check again.',
      };
    case 'unreachable':
      return {
        tone: 'warning',
        icon: AlertTriangle,
        title: `We couldn’t reach ${host}`,
        body: `${probe.detail}. Check the site URL above is correct and the site is online.`,
      };
    case 'other':
      return {
        tone: 'warning',
        icon: AlertTriangle,
        title: `${host} answered ${probe.detail}`,
        body: 'Check the site URL above points to a live page, not a missing one.',
      };
  }
}

function ResyncButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await rescrapeSiteAction(siteId).catch(() => ({
            ok: false as const,
            error: 'Could not reach the server — check your connection and try again.',
          }));
          if (result.ok) {
            toast.success('Crawl started — watch it on the Knowledge tab');
            router.push(`/dashboard/sites/${siteId}/knowledge`);
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-1 h-4 w-4" />
      )}
      Resync now
    </Button>
  );
}

/* ------------------------------------------------------------------ guides */

function CloudflareGuide({
  siteId,
  siteHost,
  ruleExpression,
  checking,
  onCheck,
}: {
  siteId: string;
  siteHost: string;
  ruleExpression: string;
  checking: boolean;
  onCheck: () => void;
}) {
  const steps = useDoneSteps(siteId, 'cloudflare');
  return (
    <Steps>
      <Step n={1} id="open" steps={steps} title="Open your custom rules">
        <ExternalButton href="https://dash.cloudflare.com/">
          Open Cloudflare
        </ExternalButton>
        <Breadcrumb
          items={[siteHost, 'Security', 'Security rules', 'Create rule', 'Custom rules']}
        />
        <Hint>
          Older Cloudflare layout:{' '}
          <Path>Security › WAF › Custom rules › Create rule</Path>
        </Hint>
      </Step>

      <Step n={2} id="name" steps={steps} title="Name the rule">
        <CopyField value={RULE_NAME} label="Rule name" />
      </Step>

      <Step n={3} id="expression" steps={steps} title="Paste the expression">
        <p>
          Under <Em>When incoming requests match…</Em>, click <Em>Edit expression</Em> and
          paste:
        </p>
        <CopyField value={ruleExpression} label="Expression" multiline />
        <Hint>
          It matches your site&apos;s private access key, so it lets in only us.
        </Hint>
      </Step>

      <Step n={4} id="action" steps={steps} title="Choose Skip, and tick exactly these">
        <p>
          Under <Em>Then take action…</Em>, choose <Em>Skip</Em>:
        </p>
        <TickList
          items={[
            { tick: true, label: 'All managed rules' },
            { tick: true, label: 'All rate limiting rules' },
            { tick: true, label: 'All Super Bot Fight Mode rules', note: 'if shown' },
            {
              tick: true,
              label: 'Browser Integrity Check',
              note: 'More components to skip',
            },
            { tick: true, label: 'Security Level', note: 'More components to skip' },
            {
              tick: false,
              label: 'All remaining custom rules',
              note: 'Cloudflare rejects it combined with the others',
            },
          ]}
        />
      </Step>

      <Step n={5} id="deploy" steps={steps} title="Put it first and deploy">
        <p>
          Set <Em>Execution order</Em> to <Em>First</Em>, leave <Em>Status</Em> on{' '}
          <Em>Active</Em>, then click <Em>Deploy</Em>.
        </p>
        <Callout>
          <strong className="font-medium text-foreground">On the Free plan?</strong> The{' '}
          <Em>Bot Fight Mode</Em> switch ignores custom rules. Turn it off under{' '}
          <Path>Security › Settings</Path> (older layout: <Path>Security › Bots</Path>).
        </Callout>
      </Step>

      <VerifyStep n={6} checking={checking} onCheck={onCheck} />
    </Steps>
  );
}

function VercelGuide({
  siteId,
  header,
  accessKey,
  checking,
  onCheck,
}: {
  siteId: string;
  header: string;
  accessKey: string;
  checking: boolean;
  onCheck: () => void;
}) {
  const steps = useDoneSteps(siteId, 'vercel');
  return (
    <Steps>
      <Step n={1} id="open" steps={steps} title="Open your project's firewall">
        <ExternalButton href="https://vercel.com/dashboard">Open Vercel</ExternalButton>
        <Breadcrumb items={['Your project', 'Firewall', 'Configure', 'New rule']} />
      </Step>

      <Step n={2} id="condition" steps={steps} title="Match our access key">
        <p>
          Name it <Em>{RULE_NAME}</Em>. Under <Em>If</Em>, choose <Em>Request Header</Em>,
          then:
        </p>
        <CopyField value={header.toLowerCase()} label="Header name" />
        <p>
          Operator <Em>Equals</Em>, value:
        </p>
        <CopyField value={accessKey} label="Access key" secret />
      </Step>

      <Step n={3} id="action" steps={steps} title="Bypass, then publish">
        <p>
          Under <Em>Then</Em>, choose <Em>Bypass</Em>. Click <Em>Save rule</Em>, then{' '}
          <Em>Review changes</Em> → <Em>Publish</Em>.
        </p>
        <Callout>
          <strong className="font-medium text-foreground">
            Attack Challenge Mode on?
          </strong>{' '}
          It challenges every visitor, us included. Turn it off while the crawl runs.
        </Callout>
      </Step>

      <VerifyStep n={4} checking={checking} onCheck={onCheck} />
    </Steps>
  );
}

function OtherGuide({
  siteId,
  header,
  accessKey,
  crawlerIp,
  checking,
  onCheck,
}: {
  siteId: string;
  header: string;
  accessKey: string;
  crawlerIp: string | null;
  checking: boolean;
  onCheck: () => void;
}) {
  const steps = useDoneSteps(siteId, 'other');
  return (
    <Steps>
      <Step n={1} id="find" steps={steps} title="Find what's blocking us">
        <p>Usually one of these:</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {[
            'Security plugin (Wordfence, iThemes…)',
            'Firewall service (Sucuri, Imperva, Akamai)',
            'Hosting control panel (cPanel, Hostinger…)',
            'AWS WAF / CloudFront',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
              {item}
            </li>
          ))}
        </ul>
      </Step>

      <Step n={2} id="allow" steps={steps} title="Add an allow rule">
        <p>
          <strong className="font-medium text-foreground">Best:</strong> allow requests
          whose header matches our key — only our crawler sends it.
        </p>
        <CopyField value={header} label="Header name" />
        <CopyField value={accessKey} label="Header value" secret />
        {crawlerIp ? (
          <>
            <p>
              <strong className="font-medium text-foreground">
                If it only supports IP addresses
              </strong>{' '}
              (Wordfence, most hosting panels), allow ours:
            </p>
            <CopyField value={crawlerIp} label="Crawler IP" />
          </>
        ) : null}
      </Step>

      <VerifyStep n={3} checking={checking} onCheck={onCheck}>
        <Hint>
          Can&apos;t change the firewall?{' '}
          <Link
            href={`/dashboard/sites/${siteId}/knowledge`}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Add your content directly
          </Link>{' '}
          — upload documents or paste text, and the assistant answers from it right away.
        </Hint>
      </VerifyStep>
    </Steps>
  );
}

/* ------------------------------------------------------------- step parts */

type DoneSteps = { isDone: (id: string) => boolean; toggle: (id: string) => void };

/**
 * Which steps the owner ticked, remembered in this browser per site and guide
 * — they often leave for Cloudflare's dashboard and come back. Storage can be
 * unavailable (private mode, blocked site data), so every access is guarded
 * and the ticks simply don't persist then.
 */
function useDoneSteps(siteId: string, guide: Guide): DoneSteps {
  const key = `crawler-access:${siteId}:${guide}`;
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
      // Reading browser storage after mount (not during render) keeps the
      // server and client HTML identical.
      if (Array.isArray(saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDone(saved.filter((x): x is string => typeof x === 'string'));
      }
    } catch {
      /* storage unavailable or corrupt — start fresh */
    }
  }, [key]);

  return {
    isDone: (id) => done.includes(id),
    toggle: (id) => {
      const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
      setDone(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable — the tick still shows for this visit */
      }
    },
  };
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="flex flex-col">{children}</ol>;
}

function Step({
  n,
  id,
  steps,
  title,
  children,
}: {
  n: number;
  id: string;
  steps: DoneSteps;
  title: string;
  children: React.ReactNode;
}) {
  const done = steps.isDone(id);
  return (
    <li className="relative flex gap-3 pb-6">
      {/* Connector to the next step. */}
      <span aria-hidden className="absolute top-8 bottom-1 left-[13px] w-px bg-border" />
      <button
        type="button"
        onClick={() => steps.toggle(id)}
        aria-pressed={done}
        aria-label={done ? `Step ${n} done — mark as not done` : `Mark step ${n} as done`}
        title={done ? 'Done — click to undo' : 'Mark as done'}
        className={cn(
          'relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-medium transition',
          done
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground',
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : n}
      </button>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-start justify-between gap-3">
          <h4
            className={cn(
              'text-sm font-medium',
              done && 'text-muted-foreground line-through decoration-muted-foreground/50',
            )}
          >
            {title}
          </h4>
          <button
            type="button"
            onClick={() => steps.toggle(id)}
            className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {done ? 'Undo' : 'Mark done'}
          </button>
        </div>
        {!done && (
          <div className="mt-2 flex flex-col gap-2.5 text-sm text-muted-foreground">
            {children}
          </div>
        )}
      </div>
    </li>
  );
}

function VerifyStep({
  n,
  checking,
  onCheck,
  children,
}: {
  n: number;
  checking: boolean;
  onCheck: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-3">
      <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border bg-background text-xs font-medium text-muted-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <h4 className="text-sm font-medium">Check it worked</h4>
        <div className="mt-2 flex flex-col gap-2.5 text-sm text-muted-foreground">
          <p>We&apos;ll test from our crawler&apos;s server. If it passes, resync.</p>
          <div>
            <Button size="sm" onClick={onCheck} disabled={checking}>
              {checking ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="mr-1 h-4 w-4" />
              )}
              Check access
            </Button>
          </div>
          {children}
        </div>
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- atoms */

/** A value to copy, right where it's needed. Secrets are masked until shown. */
function CopyField({
  value,
  label,
  multiline = false,
  secret = false,
}: {
  value: string;
  label: string;
  multiline?: boolean;
  secret?: boolean;
}) {
  const [revealed, setRevealed] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const shown = revealed ? value : `${'•'.repeat(12)}${value.slice(-4)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin, permissions): show the value so
      // it can be selected and copied by hand.
      toast.error('Couldn’t copy — select the text and copy it manually');
      setRevealed(true);
    }
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-border/60 bg-muted/40">
      <div className="min-w-0 flex-1 px-3 py-2">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <code
          className={cn(
            'block font-mono text-xs text-foreground select-all',
            multiline ? 'break-all whitespace-pre-wrap' : 'truncate',
          )}
        >
          {shown}
        </code>
      </div>
      {secret && (
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          className="grid w-10 shrink-0 place-items-center border-l border-border/60 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={cn(
          'flex shrink-0 items-center gap-1.5 border-l border-border/60 px-3 text-xs font-medium transition',
          copied
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-foreground hover:bg-muted',
        )}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}

function TickList({
  items,
}: {
  items: Array<{ tick: boolean; label: string; note?: string }>;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border/60 rounded-lg border border-border/60">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-3 px-3 py-2">
          <span
            role="img"
            aria-label={item.tick ? 'Tick' : "Don't tick"}
            className={cn(
              'mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded',
              item.tick
                ? 'bg-emerald-500 text-white'
                : 'border border-red-500/60 text-red-500',
            )}
          >
            {item.tick ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
          </span>
          <span className="min-w-0">
            <span className={cn('text-foreground', !item.tick && 'line-through')}>
              {item.label}
            </span>
            {item.note ? (
              <span className="block text-xs text-muted-foreground">{item.note}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Breadcrumb({ items }: { items: string[] }) {
  return (
    <nav aria-label="Where to click" className="flex flex-wrap items-center gap-1">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <span className="rounded-md border border-border/60 bg-background px-2 py-0.5 text-xs text-foreground">
            {item}
          </span>
        </span>
      ))}
    </nav>
  );
}

function ExternalButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div>
      <Button asChild size="sm" variant="outline">
        <a href={href} target="_blank" rel="noreferrer">
          {children}
          <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </a>
      </Button>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p>{children}</p>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function Em({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

function Path({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground">{children}</span>;
}

/* -------------------------------------------------------------- advanced */

function AdvancedSection({
  siteId,
  header,
  accessKey,
  crawlerIp,
  docsPath,
}: {
  siteId: string;
  header: string;
  accessKey: string;
  crawlerIp: string | null;
  docsPath: string;
}) {
  return (
    <details className="group rounded-xl border border-border/60 bg-background/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        Access key &amp; details
        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground transition group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-4">
        <CopyField value={header} label="Header name" />
        <CopyField value={accessKey} label="Access key" secret />
        {crawlerIp ? <CopyField value={crawlerIp} label="Crawler IP" /> : null}
        <p className="text-xs text-muted-foreground">
          Our crawler sends this key only to your site, never to other hosts. Treat it
          like a password: if it leaks, generate a new one and update your rule.{' '}
          <Link
            href={docsPath}
            target="_blank"
            className="text-foreground underline underline-offset-2"
          >
            About our crawler
          </Link>
        </p>
        <div>
          <RotateKeyButton siteId={siteId} />
        </div>
      </div>
    </details>
  );
}

function RotateKeyButton({ siteId }: { siteId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
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
                const result = await rotateCrawlAccessKeyAction(siteId).catch(() => ({
                  ok: false as const,
                  error:
                    'Could not reach the server — check your connection and try again.',
                }));
                if (result.ok) {
                  // The rule steps were done for the old key — start them over.
                  try {
                    for (const g of ['cloudflare', 'vercel', 'other'] as const) {
                      window.localStorage.removeItem(`crawler-access:${siteId}:${g}`);
                    }
                  } catch {
                    /* storage unavailable — nothing was saved */
                  }
                  toast.success('New key issued — update your firewall rule with it');
                  setOpen(false);
                  // A full reload, not router.refresh(): the step ticks live in
                  // client state and must reset along with the key.
                  window.location.reload();
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
