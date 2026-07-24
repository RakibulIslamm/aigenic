import { useEffect, useRef, useState } from 'preact/hooks';
import { sendMessage, type ChatEvent, type WidgetConfig } from '../lib/api';
import {
  clearConversationId,
  clearTranscript,
  getConversationId,
  getOrCreateVisitorId,
  loadTranscript,
  saveTranscript,
  setConversationId,
  type PersistedTextMessage,
} from '../lib/storage';
import { Message } from './Message';
import { ToolPill, type ToolStatus } from './Message';

interface ChatWindowProps {
  apiBase: string;
  config: WidgetConfig;
  onClose: () => void;
}

interface ToolEntry {
  name: string;
  status: ToolStatus;
}

const TEXTAREA_MAX_HEIGHT = 120;

/**
 * Greeting is shown when there's no persisted transcript. Wrapped so the
 * hydration callback can recompute it if needed.
 */
function initialMessages(config: WidgetConfig): PersistedTextMessage[] {
  const persisted = loadTranscript(config.siteId);
  if (persisted.length > 0) return persisted;
  return [{ role: 'bot', content: config.greeting }];
}

export function ChatWindow({ apiBase, config, onClose }: ChatWindowProps) {
  const [messages, setMessages] = useState<PersistedTextMessage[]>(() => initialMessages(config));
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const conversationIdRef = useRef<string | null>(getConversationId(config.siteId));
  const visitorIdRef = useRef<string>(getOrCreateVisitorId());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Stream batching: collect deltas into a ref + flush once per animation frame.
  // The previous implementation did `parts.map(...)` per delta, allocating the
  // full transcript array on every token. For long replies that was 90%+ of the
  // widget's CPU time during streaming.
  const bufferRef = useRef('');
  const streamingRef = useRef('');
  const frameRef = useRef<number | null>(null);

  // Persist transcript whenever it changes.
  useEffect(() => {
    saveTranscript(config.siteId, messages);
  }, [config.siteId, messages]);

  // Auto-scroll on every visible change.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText, tools, error, busy]);

  // Focus the textarea when the window first mounts.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize the textarea to fit its content (clamped by CSS max-height).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [input]);

  function flushBuffer() {
    if (bufferRef.current.length === 0) return;
    streamingRef.current += bufferRef.current;
    bufferRef.current = '';
    setStreamingText(streamingRef.current);
  }

  function scheduleFlush() {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      flushBuffer();
    });
  }

  function resetTurnState() {
    bufferRef.current = '';
    streamingRef.current = '';
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }

  function startNewChat() {
    clearConversationId(config.siteId);
    clearTranscript(config.siteId);
    conversationIdRef.current = null;
    resetTurnState();
    setMessages([{ role: 'bot', content: config.greeting }]);
    setStreamingText(null);
    setTools([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function submit(textInput?: string) {
    const text = (textInput ?? input).trim();
    if (!text || busy) return;

    setInput('');
    setError(null);
    setBusy(true);
    setTools([]);
    streamingRef.current = '';
    setStreamingText('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    const handleEvent = (event: ChatEvent) => {
      if (event.type === 'meta') {
        conversationIdRef.current = event.conversationId;
        setConversationId(config.siteId, event.conversationId);
        return;
      }
      if (event.type === 'text') {
        bufferRef.current += event.delta;
        scheduleFlush();
        return;
      }
      if (event.type === 'tool') {
        setTools((prev) => {
          if (event.status === 'running') {
            return [...prev, { name: event.name, status: 'running' }];
          }
          // Update the most recent matching running entry.
          let updated = false;
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            const entry = next[i];
            if (entry && entry.name === event.name && entry.status === 'running') {
              next[i] = { name: event.name, status: event.status };
              updated = true;
              break;
            }
          }
          return updated ? next : prev;
        });
        return;
      }
      if (event.type === 'error') {
        setError(event.message);
      }
    };

    let sawError = false;
    const wrappedHandleEvent = (event: ChatEvent) => {
      if (event.type === 'error') sawError = true;
      handleEvent(event);
    };

    try {
      await sendMessage({
        apiBase,
        siteId: config.siteId,
        conversationId: conversationIdRef.current,
        visitorId: visitorIdRef.current,
        message: text,
        onEvent: wrappedHandleEvent,
      });
    } catch (err) {
      sawError = true;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      // Make sure any pending deltas land before we commit.
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      flushBuffer();

      const finalText = streamingRef.current;
      streamingRef.current = '';
      bufferRef.current = '';
      setStreamingText(null);
      if (finalText.length > 0) {
        setMessages((prev) => [...prev, { role: 'bot', content: finalText }]);
      } else if (!sawError) {
        // Stream ended without text and without an explicit error — most often
        // a cold-start hiccup or the model returning tool-only output. Surface
        // a soft fallback so the conversation doesn't look frozen.
        setError("I didn't catch that — could you try sending your message again?");
      }
      setTools([]);
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const showTypingDots = busy && (streamingText === null || streamingText.length === 0);

  return (
    <div
      class="ad-window"
      style={{ '--ad-primary': config.primaryColor } as Record<string, string>}
    >
      <header class="ad-header">
        <div class="ad-header-avatar" aria-hidden="true">
          {config.botName.slice(0, 1).toUpperCase()}
        </div>
        <div class="ad-header-meta">
          <div class="ad-header-title">{config.botName}</div>
          <div class="ad-header-sub">
            <span class="ad-online-dot" aria-hidden="true" />
            {config.siteName}
          </div>
        </div>
        <button
          type="button"
          class="ad-icon-btn"
          onClick={startNewChat}
          aria-label="Start a new chat"
          title="New chat"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button type="button" class="ad-icon-btn" onClick={onClose} aria-label="Close chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div class="ad-messages" ref={scrollerRef}>
        {messages.map((m, i) => (
          <Message key={`m-${i}`} role={m.role} content={m.content} botName={config.botName} />
        ))}

        {tools.map((t, i) => (
          <ToolPill key={`t-${i}`} name={t.name} status={t.status} />
        ))}

        {streamingText !== null && streamingText.length > 0 && (
          <Message role="bot" content={streamingText} botName={config.botName} streaming />
        )}

        {showTypingDots && (
          <div class="ad-msg-row ad-msg-row-bot">
            <div class="ad-avatar" aria-hidden="true">
              {config.botName.slice(0, 1).toUpperCase()}
            </div>
            <div class="ad-typing" aria-label="Bot is typing">
              <span /><span /><span />
            </div>
          </div>
        )}

        {error && <div class="ad-msg-error" role="alert">{error}</div>}
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
          placeholder="Type your message…"
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
        Powered by{' '}
        <a href="https://aigenic.app" target="_blank" rel="noopener noreferrer">Aigenic</a>
      </div>
    </div>
  );
}
