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
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
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
 * Lightweight inline renderer for bot messages. Supports a small, fixed
 * subset of markdown that the support agent actually emits:
 *
 *   • [label](https://url)   → clickable link with custom label
 *   • **bold**               → emphasized text (used for item names in lists)
 *   • bare http(s) URLs      → auto-linked
 *   • \n                     → <br />
 *
 * Anything else (headings, tables, images, code fences) passes through as
 * plain text — by design. The agent is told not to use them.
 *
 * Implementation: one regex matches every token shape we care about; we walk
 * the matches in order and emit a span / link / bold for each, with plain
 * spans for the gaps between tokens.
 */
const TOKEN_RE =
  /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(https?:\/\/[^\s<>"'*[\]]+)/g;
const URL_TRAIL_RE = /[).,;:!?'"]+$/;

function renderRichText(text: string): JSX.Element[] {
  const out: JSX.Element[] = [];

  text.split(/\n/).forEach((line, lineIdx, all) => {
    let cursor = 0;
    for (const match of line.matchAll(TOKEN_RE)) {
      const start = match.index ?? 0;
      // match[1] = [label](url) whole, match[2] = label, match[3] = url
      // match[4] = **bold** whole,    match[5] = bold inner
      // match[6] = bare URL
      const mdLink = match[1];
      const mdLabel = match[2];
      const mdHref = match[3];
      const boldText = match[5];
      const bareUrl = match[6];

      if (start > cursor) {
        out.push(<span key={`s-${lineIdx}-${cursor}`}>{line.slice(cursor, start)}</span>);
      }

      if (mdLink) {
        out.push(
          <a
            key={`ml-${lineIdx}-${start}`}
            href={mdHref}
            target="_blank"
            rel="noopener noreferrer"
            class="ad-link"
          >
            {mdLabel}
          </a>,
        );
        cursor = start + mdLink.length;
      } else if (boldText !== undefined) {
        out.push(
          <strong key={`b-${lineIdx}-${start}`} class="ad-bold">
            {boldText}
          </strong>,
        );
        cursor = start + match[4]!.length;
      } else if (bareUrl) {
        let url = bareUrl;
        let trail = '';
        const trailMatch = url.match(URL_TRAIL_RE);
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
        out.push(
          <a
            key={`l-${lineIdx}-${start}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            class="ad-link"
          >
            {url}
          </a>,
        );
        if (trail) {
          out.push(<span key={`t-${lineIdx}-${start}`}>{trail}</span>);
        }
        cursor = start + bareUrl.length;
      }
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
