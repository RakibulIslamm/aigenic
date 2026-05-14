import { logger } from './logger.js';

export type WebhookEvent =
  | {
      event: 'article';
      siteId: string;
      article: {
        title: string;
        content: string;
        sourceUrl: string;
      };
    }
  | {
      event: 'complete';
      siteId: string;
      totalPages: number;
    }
  | {
      event: 'stopped';
      siteId: string;
      totalPages: number;
    }
  | {
      event: 'error';
      siteId: string;
      error: string;
    };

interface SendWebhookOptions {
  url: string;
  apiKey: string;
  payload: WebhookEvent;
  retries?: number;
}

/**
 * Sends a single webhook event back to the Aigenic app. The receiver expects
 * an X-API-Key header that matches its SCRAPER_API_KEY env var. We retry up to
 * three times on transient failures (network/5xx) with exponential backoff.
 */
export async function sendWebhook({
  url,
  apiKey,
  payload,
  retries = 3,
}: SendWebhookOptions): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return;
      }

      // 4xx is not retryable — the server rejected our payload.
      if (res.status >= 400 && res.status < 500) {
        const body = await res.text().catch(() => '');
        throw new Error(`Webhook rejected (${res.status}): ${body}`);
      }

      lastError = new Error(`Webhook returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < retries) {
      const backoff = 500 * 2 ** (attempt - 1);
      logger.warn(
        { url, attempt, backoff, err: lastError },
        'webhook delivery failed, retrying'
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Webhook delivery failed');
}
