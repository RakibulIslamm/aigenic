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
 */
function renderRichText(text: string): JSX.Element[] {
  const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
  const out: JSX.Element[] = [];

  text.split(/\n/).forEach((line, lineIdx, all) => {
    const segments = line.split(URL_RE);
    segments.forEach((seg, segIdx) => {
      if (!seg) return;
      if (URL_RE.test(seg)) {
        // Reset lastIndex — global regex state after .test()
        URL_RE.lastIndex = 0;
        out.push(
          <a
            key={`l-${lineIdx}-${segIdx}`}
            href={seg}
            target="_blank"
            rel="noopener noreferrer"
            class="ad-link"
          >
            {seg}
          </a>
        );
      } else {
        out.push(<span key={`s-${lineIdx}-${segIdx}`}>{seg}</span>);
      }
      URL_RE.lastIndex = 0;
    });
    if (lineIdx < all.length - 1) {
      out.push(<br key={`br-${lineIdx}`} />);
    }
  });

  return out;
}
