// LocalStorage isolated under per-site keys so multi-tenant pages don't share
// visitor identities accidentally. Keys are intentionally short to keep the
// bundle small.

const VISITOR_KEY = 'ad:v';
const CONVO_KEY_PREFIX = 'ad:c:';

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback for very old browsers.
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private browsing / quota — fine, we'll regenerate next session */
  }
}

export function getOrCreateVisitorId(): string {
  const existing = safeGet(VISITOR_KEY);
  if (existing) return existing;
  const fresh = uuid();
  safeSet(VISITOR_KEY, fresh);
  return fresh;
}

export function getConversationId(siteId: string): string | null {
  return safeGet(CONVO_KEY_PREFIX + siteId);
}

export function setConversationId(siteId: string, conversationId: string): void {
  safeSet(CONVO_KEY_PREFIX + siteId, conversationId);
}

export function clearConversationId(siteId: string): void {
  try {
    localStorage.removeItem(CONVO_KEY_PREFIX + siteId);
  } catch {
    /* ignore */
  }
}
