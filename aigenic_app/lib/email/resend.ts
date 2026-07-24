import { Resend } from 'resend';
import { env } from '@/lib/env';

let cachedClient: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new Resend(apiKey);
  }
  return cachedClient;
}

// Default from-address lives in the lib/env schema.
export const ESCALATION_FROM_ADDRESS = env.RESEND_FROM_ADDRESS;
