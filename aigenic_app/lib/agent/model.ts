import { createOpenAI } from '@ai-sdk/openai';

const apiKey = process.env.OPENROUTER_API_KEY;
const baseURL =
  process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

if (!apiKey && process.env.NODE_ENV !== 'test') {
  // Don't throw at import time so dev compiles even without the secret —
  // the chat route will surface a clean error if it's actually invoked.
  console.warn('OPENROUTER_API_KEY is not set. The chat endpoint will 500.');
}

/**
 * Wrap fetch so every chat-completions call ships an OpenRouter `provider`
 * preference. `deepseek/deepseek-v4-flash` is load-balanced across DeepInfra,
 * Novita, Alibaba, etc. The first cold call frequently lands on an upstream
 * that closes the socket (EPIPE / ECONNRESET), bricking the user's first
 * message. Pinning the order to DeepInfra first — with `allow_fallbacks: true`
 * so we still recover when DeepInfra itself is down — turns those into rare
 * timeouts instead of routine first-message failures.
 */
const routedFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === 'string' && init.body.includes('"messages"')) {
    try {
      const parsed = JSON.parse(init.body);
      parsed.provider = parsed.provider ?? {
        order: ['SiliconFlow', 'Novita', 'DeepInfra'],
        allow_fallbacks: true,
      };
      init = { ...init, body: JSON.stringify(parsed) };
    } catch {
      // Body wasn't JSON we recognise — pass through untouched.
    }
  }
  return fetch(input, init);
};

const openrouter = createOpenAI({
  name: 'openrouter',
  apiKey: apiKey ?? '',
  baseURL,
  headers: {
    // Optional but recommended by OpenRouter for usage attribution.
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    'X-Title': 'Aigenic',
  },
  fetch: routedFetch,
});

export const SUPPORT_MODEL_ID = 'deepseek/deepseek-v4-flash';

export const supportModel = openrouter.chat(SUPPORT_MODEL_ID);
