import { useEffect, useRef, useState } from 'preact/hooks';
import { sendMessage, type ChatEvent, type WidgetConfig } from '../lib/api';
import {
  getConversationId,
  getOrCreateVisitorId,
  setConversationId,
} from '../lib/storage';
import { Message, type MessagePart } from './Message';

interface ChatWindowProps {
  apiBase: string;
  config: WidgetConfig;
  onClose: () => void;
}

export function ChatWindow({ apiBase, config, onClose }: ChatWindowProps) {
  const [parts, setParts] = useState<MessagePart[]>(() => [
    { kind: 'text', role: 'bot', content: config.greeting },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const conversationIdRef = useRef<string | null>(getConversationId(config.siteId));
  const visitorIdRef = useRef<string>(getOrCreateVisitorId());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll to the latest message whenever the transcript changes.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [parts]);

  // Focus the textarea when the window opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;

    setInput('');
    setBusy(true);
    setParts((prev) => [
      ...prev,
      { kind: 'text', role: 'user', content: text },
    ]);

    // Append a placeholder bot message we mutate as text deltas arrive.
    let botIndex = -1;
    setParts((prev) => {
      botIndex = prev.length;
      return [...prev, { kind: 'text', role: 'bot', content: '' }];
    });

    const handleEvent = (event: ChatEvent) => {
      if (event.type === 'meta') {
        conversationIdRef.current = event.conversationId;
        setConversationId(config.siteId, event.conversationId);
        return;
      }

      if (event.type === 'text') {
        setParts((prev) =>
          prev.map((p, i) =>
            i === botIndex && p.kind === 'text' && p.role === 'bot'
              ? { ...p, content: p.content + event.delta }
              : p
          )
        );
        return;
      }

      if (event.type === 'tool') {
        // Insert the tool indicator just before the bot message we're building.
        setParts((prev) => {
          const next = [...prev];
          const idx = botIndex;
          if (event.status === 'running') {
            next.splice(idx, 0, {
              kind: 'tool',
              name: event.name,
              status: 'running',
            });
            botIndex += 1;
          } else {
            // Mutate the most recent tool-running entry for this name.
            for (let i = next.length - 1; i >= 0; i--) {
              const p = next[i];
              if (p && p.kind === 'tool' && p.name === event.name && p.status === 'running') {
                next[i] = { kind: 'tool', name: event.name, status: event.status };
                break;
              }
            }
          }
          return next;
        });
        return;
      }

      if (event.type === 'error') {
        setParts((prev) => [
          ...prev,
          { kind: 'error', message: event.message },
        ]);
        return;
      }
    };

    try {
      await sendMessage({
        apiBase,
        siteId: config.siteId,
        conversationId: conversationIdRef.current,
        visitorId: visitorIdRef.current,
        message: text,
        onEvent: handleEvent,
      });

      // Drop the empty bot bubble if the model returned no text (pure tool flow).
      setParts((prev) => {
        const placeholder = prev[botIndex];
        if (placeholder && placeholder.kind === 'text' && placeholder.role === 'bot' && placeholder.content === '') {
          return prev.filter((_, i) => i !== botIndex);
        }
        return prev;
      });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div
      class="ad-window"
      style={{ '--ad-primary': config.primaryColor } as Record<string, string>}
    >
      <div class="ad-header" style={{ background: config.primaryColor }}>
        <div>
          <div class="ad-header-title">{config.botName}</div>
          <div class="ad-header-sub">{config.siteName}</div>
        </div>
        <button type="button" class="ad-close" onClick={onClose} aria-label="Close chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="ad-messages" ref={scrollerRef}>
        {parts.map((part, i) => (
          <Message key={i} part={part} />
        ))}
        {busy && parts[parts.length - 1]?.kind !== 'text' && (
          <div class="ad-typing" aria-label="Bot is typing">
            <span /><span /><span />
          </div>
        )}
      </div>

      <form
        class="ad-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={inputRef}
          class="ad-input"
          rows={1}
          placeholder="Ask me anything…"
          value={input}
          disabled={busy}
          onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="submit"
          class="ad-send"
          style={{ background: config.primaryColor }}
          disabled={busy || input.trim().length === 0}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

      <div class="ad-footer">
        Powered by <a href="https://agentdesk.app" target="_blank" rel="noopener noreferrer">AgentDesk</a>
      </div>
    </div>
  );
}
