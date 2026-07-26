'use client';

import { useState, useTransition } from 'react';
import {
  BadgeCheck,
  ChevronDown,
  Globe,
  Loader2,
  RotateCw,
  ShieldCheck,
  ShieldQuestion,
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
import { rotateCrawlSecretAction, verifySiteAction } from '@/app/dashboard/actions';
import { CopyButton } from './copy-button';

/**
 * The ownership-verification card on a site's Settings tab.
 *
 * Two states, and the difference matters:
 *  - **Unverified** — show only how to prove ownership. The crawl secret is
 *    deliberately withheld: it exists to be pasted into a firewall rule, and
 *    handing that to whoever typed a URL is the exact thing verification
 *    prevents.
 *  - **Verified** — show the secret and the ready-made rule.
 */
export function DomainVerification({
  siteId,
  domain,
  verificationToken,
  crawlSecret,
  verifiedAt,
  verificationMethod,
  crawlerIp,
  dnsRecordName,
  dnsRecordValue,
  wellKnownPath,
  verifyHeader,
  userAgentToken,
}: {
  siteId: string;
  domain: string;
  verificationToken: string;
  crawlSecret: string;
  verifiedAt: Date | null;
  verificationMethod: string | null;
  crawlerIp: string | null;
  dnsRecordName: string;
  dnsRecordValue: string;
  wellKnownPath: string;
  verifyHeader: string;
  userAgentToken: string;
}) {
  const isVerified = verifiedAt !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isVerified ? (
            <ShieldCheck className="h-5 w-5 text-emerald-500" />
          ) : (
            <ShieldQuestion className="h-5 w-5 text-amber-500" />
          )}
          Domain ownership
          {isVerified && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Verified
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {isVerified
            ? `Ownership of ${hostOf(domain)} was confirmed via ${verificationMethod === 'dns' ? 'a DNS record' : 'the well-known file'}${verifiedAt ? ` on ${verifiedAt.toLocaleDateString()}` : ''}. Your crawl credential is below.`
            : `Prove you control ${hostOf(domain)} to unlock a private crawl credential your firewall can allow.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {isVerified ? (
          <VerifiedPanel
            siteId={siteId}
            crawlSecret={crawlSecret}
            crawlerIp={crawlerIp}
            verifyHeader={verifyHeader}
            userAgentToken={userAgentToken}
          />
        ) : (
          <UnverifiedPanel
            siteId={siteId}
            verificationToken={verificationToken}
            dnsRecordName={dnsRecordName}
            dnsRecordValue={dnsRecordValue}
            wellKnownPath={wellKnownPath}
          />
        )}
      </CardContent>
    </Card>
  );
}

function UnverifiedPanel({
  siteId,
  verificationToken,
  dnsRecordName,
  dnsRecordValue,
  wellKnownPath,
}: {
  siteId: string;
  verificationToken: string;
  dnsRecordName: string;
  dnsRecordValue: string;
  wellKnownPath: string;
}) {
  return (
    <>
      <div className="rounded-lg border border-border/60 bg-background/50 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Option 1 — DNS record <RecommendedTag />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Works even while your firewall is blocking us, which is why it&apos;s the better
          choice. Add this TXT record at your DNS provider:
        </p>
        <dl className="mt-3 space-y-2">
          <Field label="Type" value="TXT" />
          <Field label="Name / Host" value={dnsRecordName} copyable />
          <Field label="Value" value={dnsRecordValue} copyable />
        </dl>
      </div>

      <div className="rounded-lg border border-border/60 bg-background/50 p-4">
        <p className="text-sm font-medium">Option 2 — file on your site</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Upload a plain-text file at this path containing only the token. Needs your site
          to be reachable by us, so it won&apos;t work if a firewall is already blocking
          the crawler.
        </p>
        <dl className="mt-3 space-y-2">
          <Field label="Path" value={wellKnownPath} copyable />
          <Field label="Contents" value={verificationToken} copyable />
        </dl>
      </div>

      <VerifyButton siteId={siteId} />
    </>
  );
}

function VerifiedPanel({
  siteId,
  crawlSecret,
  crawlerIp,
  verifyHeader,
  userAgentToken,
}: {
  siteId: string;
  crawlSecret: string;
  crawlerIp: string | null;
  verifyHeader: string;
  userAgentToken: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [rotating, startRotate] = useTransition();

  return (
    <>
      <div className="rounded-lg border border-border/60 bg-background/50 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <BadgeCheck className="h-4 w-4 text-emerald-500" />
          Your crawl credential
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every request our crawler makes for this site carries this header. Match it in
          your firewall to let us through. Keep it private — anyone holding it can pass
          the rule you&apos;re about to write.
        </p>
        <dl className="mt-3 space-y-2">
          <Field label="Header" value={verifyHeader} copyable />
          <Field
            label="Value"
            value={revealed ? crawlSecret : '•'.repeat(32)}
            copyValue={crawlSecret}
            copyable
          />
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setRevealed((v) => !v)}>
            {revealed ? 'Hide' : 'Reveal'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={rotating}
            onClick={() => {
              startRotate(async () => {
                const result = await rotateCrawlSecretAction(siteId);
                if (result.ok) {
                  setRevealed(false);
                  toast.success(result.message ?? 'New secret issued');
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            {rotating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="mr-1 h-4 w-4" />
            )}
            Rotate
          </Button>
        </div>
      </div>

      <FirewallInstructions
        crawlerIp={crawlerIp}
        verifyHeader={verifyHeader}
        userAgentToken={userAgentToken}
      />
    </>
  );
}

/** Collapsed by default — only relevant once a crawl has actually been blocked. */
function FirewallInstructions({
  crawlerIp,
  verifyHeader,
  userAgentToken,
}: {
  crawlerIp: string | null;
  verifyHeader: string;
  userAgentToken: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border/60 bg-background/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
      >
        How to allow the crawler through your firewall
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
          <p className="mb-2">
            On Cloudflare, go to{' '}
            <span className="text-foreground">Security → WAF → Custom rules</span> and
            create a rule with action{' '}
            <span className="text-foreground">Skip → All remaining custom rules</span>{' '}
            (plus Bot Fight Mode) when:
          </p>
          <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/50 p-3 text-[11px] text-foreground">
            {`(http.request.headers["${verifyHeader.toLowerCase()}"][0] eq "<your secret>")`}
          </pre>
          <p className="mt-3">
            Other firewalls: allow requests whose{' '}
            <span className="text-foreground">{verifyHeader}</span> header equals your
            secret.
          </p>
          <p className="mt-3">
            Prefer not to use a header? Our crawler also identifies itself as{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-foreground">
              {userAgentToken}
            </code>{' '}
            in its User-Agent
            {crawlerIp ? (
              <>
                {' '}
                and always connects from{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                  {crawlerIp}
                </code>
              </>
            ) : null}
            . Those are weaker — a User-Agent can be typed by anyone — so match the header
            when you can.
          </p>
        </div>
      )}
    </div>
  );
}

function VerifyButton({ siteId }: { siteId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3">
      <Button
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await verifySiteAction(siteId);
            if (result.ok) {
              toast.success(result.message ?? 'Domain verified');
            } else {
              toast.error(result.error);
            }
          });
        }}
      >
        {pending ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <ShieldCheck className="mr-1 h-4 w-4" />
        )}
        Verify domain
      </Button>
      <p className="text-xs text-muted-foreground">
        DNS changes can take a few minutes to propagate.
      </p>
    </div>
  );
}

function RecommendedTag() {
  return (
    <span className="rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Recommended
    </span>
  );
}

function Field({
  label,
  value,
  copyValue,
  copyable,
}: {
  label: string;
  value: string;
  copyValue?: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">
        <code className="block truncate rounded-md border border-border/60 bg-muted/50 px-2 py-1 font-mono text-xs">
          {value}
        </code>
      </dd>
      {copyable && <CopyButton value={copyValue ?? value} />}
    </div>
  );
}

/** Bare hostname for prose — the stored domain is a full URL. */
function hostOf(domain: string): string {
  try {
    return new URL(domain).hostname;
  } catch {
    return domain;
  }
}
