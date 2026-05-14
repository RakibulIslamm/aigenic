import { notFound } from 'next/navigation';
import { Clock, MessageSquare, ShieldAlert, TrendingUp } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser } from '@/lib/sites/queries';
import { getSiteAnalytics } from '@/lib/sites/conversations';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ConversationsChart } from './_components/conversations-chart-loader';

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const analytics = await getSiteAnalytics(siteId);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-heading text-2xl tracking-tight">Analytics</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Month-to-date performance for the agent on this site, plus a 30-day conversation trend.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={MessageSquare}
          label="Conversations this month"
          value={analytics.monthlyConversations.toLocaleString()}
          hint="Across all visitors"
        />
        <StatCard
          icon={Clock}
          label="Avg. resolution time"
          value={
            analytics.avgResolutionMinutes == null
              ? '—'
              : formatMinutes(analytics.avgResolutionMinutes)
          }
          hint="First → last message of resolved chats"
        />
        <StatCard
          icon={ShieldAlert}
          label="Escalation rate"
          value={`${Math.round(analytics.escalationRate * 100)}%`}
          hint={`${analytics.monthlyEscalations} escalations`}
        />
        <StatCard
          icon={TrendingUp}
          label="Top topics"
          value={String(analytics.topQueries.length)}
          hint="Distinct KB searches this month"
        />
      </section>

      <Card className="border-border/60 bg-card/40">
        <CardHeader>
          <CardTitle>Conversations · last 30 days</CardTitle>
          <CardDescription>
            Daily count of new conversations started by visitors. Empty days show as zero.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConversationsChart data={analytics.daily} />
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/40">
        <CardHeader>
          <CardTitle>Top 5 most-asked topics</CardTitle>
          <CardDescription>
            Ranked by how often the agent searched the knowledge base for the same query this month.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.topQueries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No searches yet this month. Once visitors chat with the agent, common topics will appear here.
            </p>
          ) : (
            <ol className="divide-y divide-border/60">
              {analytics.topQueries.map((row, idx) => (
                <li
                  key={row.query}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
                      {idx + 1}
                    </span>
                    <span className="truncate">{row.query}</span>
                  </div>
                  <Badge variant="secondary" className="rounded-full text-xs">
                    {row.count} {row.count === 1 ? 'search' : 'searches'}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{label}</CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="font-heading text-3xl tracking-tight">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}
