import type { JSX } from 'preact';

export type ToolStatus = 'running' | 'done' | 'error';

interface MessageProps {
  role: 'user' | 'bot';
  content: string;
  botName: string;
  streaming?: boolean;
}

export function Message({ role, content, botName, streaming }: MessageProps) {
  const isUser = role === 'user';
  return (
    <div class={`ad-msg-row ${isUser ? 'ad-msg-row-user' : 'ad-msg-row-bot'}`}>
      {!isUser && (
        <div class="ad-avatar" aria-hidden="true">
          {botName.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div class={`ad-msg ${isUser ? 'ad-msg-user' : 'ad-msg-bot'}`}>
        {renderRichText(content)}
        {streaming && <span class="ad-cursor" aria-hidden="true" />}
      </div>
    </div>
  );
}

interface ToolPillProps {
  name: string;
  status: ToolStatus;
}

export function ToolPill({ name, status }: ToolPillProps) {
  if (status === 'done') return null;
  const label = status === 'error' ? `${humanizeTool(name)} failed` : humanizeTool(name);
  return (
    <div class={`ad-tool ad-tool-${status}`} role="status">
      <span class="ad-tool-icon" aria-hidden="true">
        {status === 'running' ? <span class="ad-spinner" /> : <ErrorIcon />}
      </span>
      <span>{label}</span>
    </div>
  );
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
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

/**
 * Lightweight inline renderer: turns http(s) URLs into clickable links and
 * preserves line breaks. We deliberately don't pull in a markdown lib — the
 * agent's responses are plain prose with the occasional link.
 *
 * URL boundary rules:
 *   - The character class excludes `*`, `[`, `]` so markdown emphasis
 *     (`**url**`) and link syntax (`[label](url)`) don't get pulled in.
 *   - After matching, trailing sentence punctuation is stripped onto the
 *     text run, but a closing `)` is kept if it balances an opening `(`
 *     inside the URL (e.g. Wikipedia `Foo_(bar)`).
 */
function renderRichText(text: string): JSX.Element[] {
  const URL_RE = /(https?:\/\/[^\s<>"'*[\]]+)/g;
  const TRAIL_RE = /[).,;:!?'"]+$/;
  const out: JSX.Element[] = [];

  text.split(/\n/).forEach((line, lineIdx, all) => {
    let cursor = 0;
    for (const match of line.matchAll(URL_RE)) {
      const start = match.index ?? 0;
      let url = match[0];
      let trail = '';

      const trailMatch = url.match(TRAIL_RE);
      if (trailMatch) {
        trail = trailMatch[0];
        url = url.slice(0, -trail.length);
      }
      // Restore a trailing `)` that closes an opening `(` inside the URL.
      while (trail.startsWith(')')) {
        const opens = (url.match(/\(/g) ?? []).length;
        const closes = (url.match(/\)/g) ?? []).length;
        if (opens > closes) {
          url += ')';
          trail = trail.slice(1);
        } else {
          break;
        }
      }

      if (start > cursor) {
        out.push(
          <span key={`s-${lineIdx}-${cursor}`}>{line.slice(cursor, start)}</span>
        );
      }
      out.push(
        <a
          key={`l-${lineIdx}-${start}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          class="ad-link"
        >
          {url}
        </a>
      );
      if (trail) {
        out.push(<span key={`t-${lineIdx}-${start}`}>{trail}</span>);
      }
      cursor = start + match[0].length;
    }
    if (cursor < line.length) {
      out.push(<span key={`s-${lineIdx}-${cursor}`}>{line.slice(cursor)}</span>);
    }
    if (lineIdx < all.length - 1) {
      out.push(<br key={`br-${lineIdx}`} />);
    }
  });

  return out;
}
