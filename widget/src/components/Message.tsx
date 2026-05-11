export type MessagePart =
  | { kind: 'text'; role: 'user' | 'bot'; content: string }
  | { kind: 'tool'; name: string; status: 'running' | 'done' | 'error' }
  | { kind: 'error'; message: string };

interface MessageProps {
  part: MessagePart;
}

export function Message({ part }: MessageProps) {
  if (part.kind === 'text') {
    const cls = part.role === 'user' ? 'ad-msg ad-msg-user' : 'ad-msg ad-msg-bot';
    return <div class={cls}>{part.content}</div>;
  }

  if (part.kind === 'tool') {
    if (part.status === 'done') return null;
    return (
      <div class="ad-tool" role="status">
        <span class="ad-dot" />
        {part.status === 'error'
          ? `${humanizeTool(part.name)} failed`
          : `${humanizeTool(part.name)}…`}
      </div>
    );
  }

  return <div class="ad-msg-error">{part.message}</div>;
}

function humanizeTool(name: string): string {
  switch (name) {
    case 'search_knowledge_base':
      return 'Searching the knowledge base';
    case 'get_article':
      return 'Reading an article';
    case 'escalate_to_human':
      return 'Notifying the support team';
    default:
      return name.replace(/_/g, ' ');
  }
}
