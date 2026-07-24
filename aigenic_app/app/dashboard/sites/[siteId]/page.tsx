import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, BookOpen, MessageSquare, ShieldAlert } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser, getSiteStats } from '@/lib/sites/queries';
import { listConversationsFiltered } from '@/lib/sites/conversations';
import { RECENT_CONVERSATIONS_LIMIT } from '@/lib/sites/limits';
import { StatCard } from '@/components/stat-card';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default async function SiteOverviewPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const [stats, conversations] = await Promise.all([
    getSiteStats(siteId),
    listConversationsFiltered(siteId, 'all', RECENT_CONVERSATIONS_LIMIT),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={BookOpen}
          label="Pages indexed"
          value={stats.articleCount}
          hint="In the knowledge base"
        />
        <StatCard
          icon={MessageSquare}
          label="Conversations this month"
          value={stats.conversationCount}
          hint="Across all visitors"
        />
        <StatCard
          icon={ShieldAlert}
          label="Escalation rate"
          value={`${Math.round(stats.escalationRate * 100)}%`}
          hint={`${stats.escalationCount} escalations`}
        />
      </section>

      <Card className="border-border/60 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Recent conversations</CardTitle>
            <CardDescription>The five most recent chats from your widget.</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href={`/dashboard/sites/${siteId}/conversations`}>
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {conversations.length === 0 ? (
            <EmptyConversations />
          ) : (
            <ul className="divide-y divide-border/60">
              {conversations.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {c.visitorEmail ?? `Visitor ${c.visitorId.slice(0, 8)}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.messageCount} message{c.messageCount === 1 ? '' : 's'} ·{' '}
                      {formatDistanceToNow(c.createdAt, { addSuffix: true })}
                    </div>
                  </div>
                  <Badge variant="secondary" className="rounded-full text-xs capitalize">
                    {c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyConversations() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <MessageSquare className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No conversations yet</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Once the chat bubble is live on your site and a visitor sends a message, it&apos;ll appear here.
      </p>
    </div>
  );
}
