export interface WidgetConfig {
  siteId: string;
  siteName: string;
  botName: string;
  greeting: string;
  primaryColor: string;
  kbReady: boolean;
}

export type ChatEvent =
  | { type: 'meta'; conversationId: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error' }
  | { type: 'done'; conversationId: string }
  | { type: 'error'; message: string };

export async function fetchConfig(
  apiBase: string,
  siteId: string
): Promise<WidgetConfig> {
  const res = await fetch(`${apiBase}/api/widget/config?siteId=${encodeURIComponent(siteId)}`);
  if (!res.ok) {
    throw new Error(`Config fetch failed (${res.status})`);
  }
  return (await res.json()) as WidgetConfig;
}

export interface SendMessageOptions {
  apiBase: string;
  siteId: string;
  conversationId: string | null;
  visitorId: string;
  message: string;
  onEvent: (event: ChatEvent) => void;
  signal?: AbortSignal;
}

/**
 * POSTs the user message and parses the SSE stream sent by /api/widget/chat,
 * dispatching one onEvent callback per server event. Returns when the stream
 * is fully consumed (either `done` or `error` was received).
 */
export async function sendMessage({
  apiBase,
  siteId,
  conversationId,
  visitorId,
  message,
  onEvent,
  signal,
}: SendMessageOptions): Promise<void> {
  const res = await fetch(`${apiBase}/api/widget/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siteId,
      ...(conversationId ? { conversationId } : {}),
      visitorId,
      message,
    }),
    signal: signal ?? null,
  });

  if (!res.ok || !res.body) {
    let detail = '';
    try {
      detail = (await res.json()).error ?? '';
    } catch {
      /* ignore */
    }
    onEvent({
      type: 'error',
      message: detail || `Server returned ${res.status}`,
    });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are delimited by a blank line.
      let separatorIdx: number;
      while ((separatorIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + 2);
        const payload = parseSseEvent(rawEvent);
        if (payload) onEvent(payload);
      }
    }
  } catch (err) {
    onEvent({
      type: 'error',
      message: err instanceof Error ? err.message : 'Stream interrupted',
    });
  }
}

function parseSseEvent(raw: string): ChatEvent | null {
  // Each event is a series of `field: value` lines. We only care about `data:`.
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join('\n')) as ChatEvent;
  } catch {
    return null;
  }
}
