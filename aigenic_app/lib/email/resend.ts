import { Resend } from 'resend';

let cachedClient: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new Resend(apiKey);
  }
  return cachedClient;
}

export const ESCALATION_FROM_ADDRESS =
  process.env.RESEND_FROM_ADDRESS ?? 'Aigenic <agent@notifications.aigenic.app>';
