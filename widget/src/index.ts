import { h, render } from 'preact';
import { App } from './App';
// Vite inlines the CSS as a string when imported with the ?inline query.
import styles from './styles.css?inline';

const HOST_ID = 'aigenic-widget-host';
const SCRIPT_NAME = 'widget.js';

interface BootOptions {
  siteId: string;
  apiBase: string;
}

function readBootOptions(): BootOptions | null {
  // Find the <script> tag that loaded us so we can read its data-site attr
  // and derive the API origin from its src.
  const scripts = document.querySelectorAll<HTMLScriptElement>(`script[src*="${SCRIPT_NAME}"]`);
  let siteId: string | null = null;
  let apiBase = '';

  for (const script of Array.from(scripts)) {
    const sid = script.dataset.site;
    if (sid) {
      siteId = sid;
      try {
        const url = new URL(script.src, window.location.href);
        apiBase = `${url.protocol}//${url.host}`;
      } catch {
        apiBase = window.location.origin;
      }
      break;
    }
  }

  // Fallback for environments where the script tag isn't discoverable
  // (e.g. injected via fetch + eval, or programmatic loaders).
  const globalCfg = (window as unknown as { AigenicConfig?: { siteId?: string; apiBase?: string } }).AigenicConfig;
  if (!siteId && globalCfg?.siteId) siteId = globalCfg.siteId;
  if (globalCfg?.apiBase) apiBase = globalCfg.apiBase;

  if (!siteId) return null;
  return { siteId, apiBase: apiBase || window.location.origin };
}

function mount(options: BootOptions) {
  if (document.getElementById(HOST_ID)) return; // idempotent

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Inject the bundled stylesheet into the shadow root so host-page CSS
  // can't reach the widget and our styles can't leak out.
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  shadow.appendChild(styleEl);

  const root = document.createElement('div');
  shadow.appendChild(root);

  render(h(App, options), root);
}

function boot() {
  const options = readBootOptions();
  if (!options) {
    console.warn('Aigenic widget: missing data-site attribute on <script> tag');
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(options), { once: true });
  } else {
    mount(options);
  }
}

boot();
