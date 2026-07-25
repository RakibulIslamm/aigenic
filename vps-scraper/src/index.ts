import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { logger } from './logger.js';
import { runCrawl } from './crawler.js';
import { crawlRequestSchema } from './schemas.js';

const PORT = Number(process.env.PORT ?? 3007);
const API_KEY = process.env.SCRAPER_API_KEY;
const MAX_BODY = '1mb';

if (!API_KEY) {
  // Refusing to start is deliberate — booting without a key would expose an
  // unauthenticated crawler. Say how to supply it, since the usual way to hit
  // this is running the image directly instead of through compose.
  // Single line on purpose: pino emits JSON in the container, where embedded
  // newlines come out as literal \n and are horrible to read.
  logger.error(
    'SCRAPER_API_KEY is not set — refusing to start, since an unauthenticated crawler ' +
      'would let anyone POST /crawl. Supply it with `docker compose up -d` (reads ' +
      'vps-scraper/.env), `docker run -e SCRAPER_API_KEY=… -p 127.0.0.1:3007:3007 ' +
      'aigenic-scraper`, or `pnpm dev` / `pnpm start:local` (both read --env-file=.env). ' +
      'It must match SCRAPER_API_KEY in the Next.js app — see vps-scraper/.env.example.',
  );
  process.exit(1);
}

/**
 * In-memory registry of running crawls, keyed by siteId. Only one crawl per
 * site can be active at a time — starting a new crawl aborts any existing
 * one. Survives only the lifetime of this process; if the scraper restarts,
 * any abandoned `crawling` kbStatus rows are reconciled via the app's normal
 * webhook-timeout flow.
 */
const activeCrawls = new Map<string, AbortController>();

const app = express();

app.use(helmet());
app.use(express.json({ limit: MAX_BODY }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'aigenic-scraper', uptime: process.uptime() });
});

app.use('/crawl', requireApiKey);
app.post('/crawl', (req, res) => {
  const parsed = crawlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Invalid payload', issues: parsed.error.issues });
  }

  const { siteId, startUrl, maxPages, generation, webhookUrl } = parsed.data;
  const jobId = randomUUID();

  // If a crawl is already running for this site (e.g. user hit "recrawl"
  // before the previous one finished), abort it before starting the new one.
  const existing = activeCrawls.get(siteId);
  if (existing) {
    logger.info({ siteId }, 'aborting prior crawl before starting new one');
    existing.abort();
  }

  const controller = new AbortController();
  activeCrawls.set(siteId, controller);

  logger.info({ jobId, siteId, startUrl, maxPages, generation }, 'crawl job accepted');

  // Detach the crawl from the request lifecycle — the webhook is the result channel.
  void runCrawl({
    siteId,
    startUrl,
    maxPages,
    generation,
    webhookUrl,
    webhookApiKey: API_KEY,
    signal: controller.signal,
  })
    .catch((err) => {
      logger.error({ jobId, siteId, err }, 'unhandled crawl error');
    })
    .finally(() => {
      // Only clear if this is still the current controller — guards against
      // a late finish overwriting a newer crawl.
      if (activeCrawls.get(siteId) === controller) {
        activeCrawls.delete(siteId);
      }
    });

  return res.status(202).json({ jobId, siteId, status: 'queued' });
});

app.post('/crawl/:siteId/stop', (req, res) => {
  const siteId = req.params.siteId;
  const controller = activeCrawls.get(siteId);
  if (!controller) {
    return res.status(200).json({ stopped: false, reason: 'no active crawl' });
  }
  controller.abort();
  activeCrawls.delete(siteId);
  logger.info({ siteId }, 'crawl stop requested');
  return res.status(200).json({ stopped: true });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'aigenic-scraper listening');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'shutdown requested');
  server.close(() => process.exit(0));
  // Hard exit if connections won't close.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const provided = req.header('x-api-key');
  if (!provided || provided !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
