import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ArrowUpRight, Globe, MessageSquare, Sparkles } from 'lucide-react';
import { getOrCreateUser } from '@/lib/auth/user';
import { listSitesForUser, type SiteListItem } from '@/lib/sites/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AddSiteDialog } from './_components/add-site-dialog';
import { KbStatusBadge } from './_components/kb-status-badge';
import { CrawlProgress } from './_components/crawl-progress';

export default async function DashboardPage() {
  const user = await getOrCreateUser();
  const sites = await listSitesForUser(user.id);

  const totalConversations = sites.reduce((sum, s) => sum + s.conversationCount, 0);
  const limits = planLimits(user.plan);
  const anyInProgress = sites.some(
    (s) => s.kbStatus === 'pending' || s.kbStatus === 'crawling'
  );

  return (
    <div className="flex flex-col gap-10">
      {anyInProgress && <CrawlProgress status="crawling" />}

      <section className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm text-muted-foreground">Welcome back</p>
          <h1 className="mt-1 font-serif text-4xl tracking-tight md:text-5xl">
            Your sites
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            A site is one product you&apos;ve added AgentDesk to. Each has its own knowledge base, widget config, and escalation inbox.
          </p>
        </div>
        <AddSiteDialog
          disabled={sites.length >= limits.sites}
          disabledReason={`Your ${user.plan} plan is limited to ${limits.sites} site${limits.sites === 1 ? '' : 's'}`}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard icon={Globe} label="Sites" value={sites.length} hint={`of ${limits.sites} on ${user.plan}`} />
        <StatCard
          icon={MessageSquare}
          label="Conversations this month"
          value={totalConversations}
          hint={limits.conversations === Infinity ? 'Unlimited' : `of ${limits.conversations} on ${user.plan}`}
        />
        <StatCard
          icon={Sparkles}
          label="Plan"
          value={user.plan === 'pro' ? 'Pro' : 'Free'}
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

function planLimits(plan: string) {
  if (plan === 'pro') return { sites: 5, conversations: Infinity };
  return { sites: 1, conversations: 100 };
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="font-serif text-3xl tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
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
          <Stat label="Articles" value={site.articleCount} />
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
      <div className="font-serif text-2xl tracking-tight">{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
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
          <h3 className="font-serif text-2xl tracking-tight">No sites yet</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Add your product&apos;s URL — we&apos;ll crawl it to build a knowledge base, and hand you a one-line embed code.
          </p>
        </div>
        <AddSiteDialog />
      </CardContent>
    </Card>
  );
}
