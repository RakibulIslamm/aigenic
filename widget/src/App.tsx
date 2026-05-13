import { useEffect, useState } from 'preact/hooks';
import { ChatBubble } from './components/ChatBubble';
import { ChatWindow } from './components/ChatWindow';
import { fetchConfig, type WidgetConfig } from './lib/api';

interface AppProps {
  apiBase: string;
  siteId: string;
}

export function App({ apiBase, siteId }: AppProps) {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [mountWindow, setMountWindow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchConfig(apiBase, siteId)
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load widget');
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, siteId]);

  // Keep the window mounted briefly after close so the exit animation can run.
  useEffect(() => {
    if (open) {
      setMountWindow(true);
      return;
    }
    if (!mountWindow) return;
    const t = window.setTimeout(() => setMountWindow(false), 220);
    return () => window.clearTimeout(t);
  }, [open, mountWindow]);

  if (!config) {
    if (error) {
      console.warn('AgentDesk widget failed to load:', error);
    }
    return null;
  }

  return (
    <div class="ad-host">
      {mountWindow && (
        <div class={`ad-window-wrap ${open ? 'is-open' : 'is-closing'}`}>
          <ChatWindow apiBase={apiBase} config={config} onClose={() => setOpen(false)} />
        </div>
      )}
      <ChatBubble
        onClick={() => setOpen((v) => !v)}
        primaryColor={config.primaryColor}
        open={open}
      />
    </div>
  );
}
