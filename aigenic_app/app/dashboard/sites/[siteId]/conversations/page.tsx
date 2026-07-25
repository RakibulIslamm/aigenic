import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ArrowUpRight, MailWarning, MessageSquare, User } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser } from '@/lib/sites/queries';
import {
  countPendingEscalationEmails,
  getConversationStatusCounts,
  listConversationsFiltered,
  type ConversationStatusFilter,
} from '@/lib/sites/conversations';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FilterTabs, type FilterValue } from './_components/filter-tabs';
import { STATUS_STYLES } from './status-styles';

const FILTER_VALUES: FilterValue[] = ['all', 'active', 'escalated', 'resolved'];

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { siteId } = await params;
  const { status } = await searchParams;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const filter = normalizeFilter(status);

  // Three queries in parallel: status counts (one GROUP BY), the visible page
  // (capped at the default CONVERSATION_LIST_LIMIT), and the count of
  // escalations whose owner email is still undelivered.
  const [counts, visible, pendingEscalations] = await Promise.all([
    getConversationStatusCounts(siteId),
    listConversationsFiltered(siteId, filter),
    countPendingEscalationEmails(siteId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="font-heading text-2xl tracking-tight">Conversations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every visitor session, with full transcripts and one-click escalation
            hand-off.
          </p>
          {pendingEscalations > 0 && (
            <Badge
              variant="outline"
              className="mt-2 gap-1 rounded-full border-amber-500/40 bg-amber-500/10 text-xs text-amber-300"
            >
              <MailWarning className="h-3 w-3" />
              {pendingEscalations} escalation email
              {pendingEscalations === 1 ? '' : 's'} pending delivery
            </Badge>
          )}
        </div>
        <FilterTabs counts={counts} />
      </header>

      {visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <Card className="border-border/60 bg-card/40">
          <CardContent className="p-0">
            <ul className="divide-y divide-border/60">
              {visible.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/sites/${siteId}/conversations/${c.id}`}
                    className="group flex items-start gap-4 px-5 py-4 text-sm transition hover:bg-card/60"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate font-medium">
                          {c.visitorEmail ?? 'Anonymous visitor'}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          · {c.messageCount} message{c.messageCount === 1 ? '' : 's'} ·{' '}
                          {formatDistanceToNow(c.createdAt, { addSuffix: true })}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                        {c.preview ?? (
                          <span className="italic opacity-70">No messages yet</span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge
                        variant="outline"
                        className={`rounded-full text-xs capitalize ${STATUS_STYLES[c.status] ?? ''}`}
                      >
                        {c.status}
                      </Badge>
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function normalizeFilter(value: string | undefined): ConversationStatusFilter {
  if (value && (FILTER_VALUES as string[]).includes(value)) {
    return value as ConversationStatusFilter;
  }
  return 'all';
}

function EmptyState({ filter }: { filter: ConversationStatusFilter }) {
  const blurb =
    filter === 'all'
      ? 'Once the widget is live and a visitor sends a message, every chat will show up here.'
      : `Nothing in "${filter}" right now. Switch the filter to "All" to see everything.`;

  return (
    <Card className="border-dashed border-border/60 bg-card/20">
      <CardHeader className="items-center text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-border/60 bg-background">
          <MessageSquare className="h-5 w-5" />
        </div>
        <CardTitle className="font-heading text-2xl tracking-tight">
          No conversations
        </CardTitle>
        <CardDescription className="max-w-md">{blurb}</CardDescription>
      </CardHeader>
    </Card>
  );
}
