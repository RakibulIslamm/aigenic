import { createOpenAI } from '@ai-sdk/openai';

const apiKey = process.env.OPENROUTER_API_KEY;
const baseURL =
  process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

if (!apiKey && process.env.NODE_ENV !== 'test') {
  // Don't throw at import time so dev compiles even without the secret —
  // the chat route will surface a clean error if it's actually invoked.
  console.warn('OPENROUTER_API_KEY is not set. The chat endpoint will 500.');
}

const openrouter = createOpenAI({
  name: 'openrouter',
  apiKey: apiKey ?? '',
  baseURL,
  headers: {
    // Optional but recommended by OpenRouter for usage attribution.
    'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    'X-Title': 'AgentDesk',
  },
});

export const SUPPORT_MODEL_ID = 'deepseek/deepseek-v4-flash';

export const supportModel = openrouter.chat(SUPPORT_MODEL_ID);
