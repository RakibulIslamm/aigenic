import { notFound } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser, listConversationsForSite } from '@/lib/sites/queries';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const STATUS_STYLES: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  resolved: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-200',
  escalated: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
};

export default async function ConversationsPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const conversations = await listConversationsForSite(siteId, 100);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-serif text-2xl tracking-tight">Conversations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The 100 most recent visitor sessions. Click a row to view the full transcript (coming in Phase 4).
        </p>
      </header>

      {conversations.length === 0 ? (
        <EmptyState />
      ) : (
        <Card className="border-border/60 bg-card/40">
          <CardContent className="p-0">
            <ul className="divide-y divide-border/60">
              {conversations.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-4 px-5 py-4 text-sm transition hover:bg-card/60"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {c.visitorEmail ?? `Visitor ${c.visitorId.slice(0, 8)}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.messageCount} message{c.messageCount === 1 ? '' : 's'} ·{' '}
                      {formatDistanceToNow(c.createdAt, { addSuffix: true })}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`rounded-full text-xs capitalize ${STATUS_STYLES[c.status] ?? ''}`}
                  >
                    {c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed border-border/60 bg-card/20">
      <CardHeader className="items-center text-center">
        <div className="grid h-12 w-12 place-items-center rounded-xl border border-border/60 bg-background">
          <MessageSquare className="h-5 w-5" />
        </div>
        <CardTitle className="font-serif text-2xl tracking-tight">No conversations yet</CardTitle>
        <CardDescription className="max-w-md">
          Once the widget is live on your site and a visitor sends a message, every chat will show up here with status and message count.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
