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

  // Don't render anything until we have config — keeps the bubble color and
  // bot name correct from first paint.
  if (!config) {
    if (error) {
      console.warn('AgentDesk widget failed to load:', error);
    }
    return null;
  }

  return (
    <div class="ad-host">
      {open ? (
        <ChatWindow apiBase={apiBase} config={config} onClose={() => setOpen(false)} />
      ) : (
        <ChatBubble onClick={() => setOpen(true)} primaryColor={config.primaryColor} />
      )}
    </div>
  );
}
