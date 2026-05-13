import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { ChevronLeft, FileText, Mail, MessageSquare, Search, ShieldAlert, User, Wrench } from 'lucide-react';
import { requireUserId } from '@/lib/auth/user';
import { getSiteForUser } from '@/lib/sites/queries';
import { getConversationDetail } from '@/lib/sites/conversations';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ResolveButton } from './_components/resolve-button';

const STATUS_STYLES: Record<string, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  resolved: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-200',
  escalated: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
};

interface ToolCallRecord {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output?: unknown;
}

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ siteId: string; conversationId: string }>;
}) {
  const { siteId, conversationId } = await params;
  const userId = await requireUserId();
  const site = await getSiteForUser(siteId, userId);
  if (!site) notFound();

  const detail = await getConversationDetail(conversationId, siteId);
  if (!detail) notFound();

  const { conversation, messages: thread, escalation, visitorStats } = detail;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between">
          <Link
            href={`/dashboard/sites/${siteId}/conversations`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            All conversations
          </Link>
          <Badge
            variant="outline"
            className={`rounded-full text-xs capitalize ${STATUS_STYLES[conversation.status] ?? ''}`}
          >
            {conversation.status}
          </Badge>
        </div>

        <Card className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden border-border/60 bg-card/40">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">
                {conversation.visitorEmail ?? 'Anonymous visitor'}
              </CardTitle>
              <CardDescription>
                Started {format(conversation.createdAt, 'PPp')}
              </CardDescription>
            </div>
            {conversation.status !== 'resolved' && (
              <ResolveButton siteId={siteId} conversationId={conversation.id} />
            )}
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 overflow-y-auto pt-0">
            {thread.length === 0 && (
              <EmptyTranscript />
            )}
            {thread.map((m) => {
              const toolCalls = (m.toolCalls as ToolCallRecord[] | null | undefined) ?? null;
              return (
                <div key={m.id} className="flex min-w-0 flex-col gap-2">
                  <MessageBubble role={m.role} content={m.content} createdAt={m.createdAt} />
                  {toolCalls && toolCalls.length > 0 && (
                    <ToolCallsAccordion toolCalls={toolCalls} />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <aside className="flex flex-col gap-4">
        <SidebarCard
          icon={User}
          title="Visitor"
          rows={[
            ['Email', conversation.visitorEmail ?? 'Not provided'],
            ['Visitor ID', shortId(conversation.visitorId)],
            ['First seen', formatDistanceToNow(visitorStats.firstSeen, { addSuffix: true })],
            ['Total conversations', String(visitorStats.totalConversations)],
          ]}
        />

        <SidebarCard
          icon={MessageSquare}
          title="This conversation"
          rows={[
            ['Status', conversation.status],
            ['Messages', String(thread.length)],
            ['Created', format(conversation.createdAt, 'PPp')],
          ]}
        />

        {escalation && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="space-y-1 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldAlert className="h-4 w-4 text-amber-300" />
                Escalation
              </CardTitle>
              <CardDescription>{escalation.reason}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 text-xs text-muted-foreground">
              {escalation.emailSentAt ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Email sent {formatDistanceToNow(escalation.emailSentAt, { addSuffix: true })}
                </span>
              ) : (
                <span>Email delivery pending</span>
              )}
            </CardContent>
          </Card>
        )}
      </aside>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  createdAt,
}: {
  role: string;
  content: string;
  createdAt: Date;
}) {
  const isUser = role === 'user';
  const isAssistant = role === 'assistant';

  if (!content) return null;

  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'rounded-tr-sm bg-foreground text-background'
            : isAssistant
              ? 'rounded-tl-sm border border-border/60 bg-card text-foreground'
              : 'rounded-tl-sm bg-muted/40 text-muted-foreground',
        ].join(' ')}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
        <p
          className={[
            'mt-1 text-[10px]',
            isUser ? 'text-background/60' : 'text-muted-foreground',
          ].join(' ')}
        >
          {format(createdAt, 'p')}
        </p>
      </div>
    </div>
  );
}

function ToolCallsAccordion({ toolCalls }: { toolCalls: ToolCallRecord[] }) {
  return (
    <Accordion type="single" collapsible className="ml-2">
      {toolCalls.map((call, i) => {
        const meta = describeTool(call.toolName);
        const Icon = meta.icon;
        return (
          <AccordionItem
            key={call.toolCallId ?? `${call.toolName}-${i}`}
            value={`call-${i}`}
            className="rounded-md border border-border/40 bg-background/40"
          >
            <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground/90">{meta.label}</span>
                <span className="font-mono text-[10px] opacity-60">{call.toolName}</span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3">
              <div className="grid min-w-0 gap-2 text-xs">
                <KvBlock label="Input" value={call.input} />
                {call.output !== undefined && (
                  <KvBlock label="Output" value={call.output} />
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

function KvBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-64 max-w-full overflow-auto whitespace-pre-wrap wrap-break-word rounded bg-muted/40 p-2 text-[11px] leading-snug text-foreground/80">
{JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function SidebarCard({
  icon: Icon,
  title,
  rows,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  rows: Array<[string, string]>;
}) {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 pt-0 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">{label}</span>
            <span className="truncate text-right font-medium text-foreground" title={value}>
              {value}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyTranscript() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <MessageSquare className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">No messages yet</p>
      <p className="text-xs text-muted-foreground">
        This conversation is created but the visitor hasn&apos;t sent anything.
      </p>
    </div>
  );
}

type ToolMeta = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

function describeTool(name: string): ToolMeta {
  switch (name) {
    case 'search_knowledge_base':
      return { label: 'Searched knowledge base', icon: Search };
    case 'get_article':
      return { label: 'Opened article', icon: FileText };
    case 'escalate_to_human':
      return { label: 'Escalated to human', icon: ShieldAlert };
    default:
      return { label: name, icon: Wrench };
  }
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
