import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ArrowUpRight, Globe, MessageSquare, Sparkles } from 'lucide-react';
import { getOrCreateUser } from '@/lib/auth/user';
import { listSitesForUser, type SiteListItem } from '@/lib/sites/queries';
import { countConversationsThisMonthForUser } from '@/lib/sites/conversations';
import { getPlan } from '@/lib/billing/plans';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatCard } from '@/components/stat-card';
import { AddSiteDialog } from './_components/add-site-dialog';
import { KbStatusBadge } from './_components/kb-status-badge';
import { CrawlProgress } from './_components/crawl-progress';

export default async function DashboardPage() {
  const user = await getOrCreateUser();
  // Same monthly count the billing page and chat quota use, so the two screens
  // can't disagree (the per-site card counts remain all-time).
  const [sites, monthlyConversations] = await Promise.all([
    listSitesForUser(user.id),
    countConversationsThisMonthForUser(user.id),
  ]);

  const plan = getPlan(user.plan);
  const limits = {
    sites: plan.limits.sites,
    conversations: plan.limits.conversationsPerMonth,
  };
  const anyInProgress = sites.some(
    (s) => s.kbStatus === 'pending' || s.kbStatus === 'crawling',
  );

  return (
    <div className="flex flex-col gap-10">
      {anyInProgress && <CrawlProgress status="crawling" />}

      <section className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm text-muted-foreground">Welcome back</p>
          <h1 className="mt-1 font-heading text-4xl tracking-tight md:text-5xl">
            Your sites
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            A site is one website you&apos;ve connected Aigenic to. Each has its own
            knowledge base, widget config, and escalation inbox.
          </p>
        </div>
        <AddSiteDialog
          disabled={sites.length >= limits.sites}
          disabledReason={`Your ${user.plan} plan is limited to ${limits.sites} site${limits.sites === 1 ? '' : 's'}`}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={Globe}
          label="Sites"
          value={sites.length}
          hint={`of ${limits.sites} on ${plan.name}`}
        />
        <StatCard
          icon={MessageSquare}
          label="Conversations this month"
          value={monthlyConversations}
          hint={`of ${limits.conversations} on ${plan.name}`}
        />
        <StatCard
          icon={Sparkles}
          label="Plan"
          value={plan.name}
          hint={user.plan === 'pro' ? 'Manage in Billing' : 'Upgrade in Billing'}
        />
      </section>

      {sites.length === 0 ? (
        <EmptyState />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </section>
      )}
    </div>
  );
}

function SiteCard({ site }: { site: SiteListItem }) {
  const lastSynced = site.kbLastSyncedAt
    ? formatDistanceToNow(site.kbLastSyncedAt, { addSuffix: true })
    : null;

  return (
    <Card className="group flex flex-col border-border/60 bg-card/40 transition hover:border-border hover:bg-card/70">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{site.name}</CardTitle>
            <CardDescription className="truncate text-xs">{site.domain}</CardDescription>
          </div>
          <KbStatusBadge status={site.kbStatus} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-end gap-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Pages" value={site.articleCount} />
          <Stat label="Conversations" value={site.conversationCount} />
        </div>
        {lastSynced && (
          <p className="text-xs text-muted-foreground">Synced {lastSynced}</p>
        )}
        <div className="flex items-center justify-between">
          <Button asChild size="sm" variant="outline">
            <Link href={`/dashboard/sites/${site.id}/widget`}>Widget code</Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="gap-1">
            <Link href={`/dashboard/sites/${site.id}`}>
              Open
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="font-heading text-2xl tracking-tight">{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed border-border/60 bg-card/20">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-border/60 bg-background">
          <Globe className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-heading text-2xl tracking-tight">No sites yet</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Add your website&apos;s URL — we&apos;ll crawl it to build a knowledge base,
            and hand you a one-line embed code.
          </p>
        </div>
        <AddSiteDialog />
      </CardContent>
    </Card>
  );
}
