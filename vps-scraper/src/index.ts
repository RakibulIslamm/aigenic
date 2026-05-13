import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { logger } from './logger.js';
import { runCrawl } from './crawler.js';

const PORT = Number(process.env.PORT ?? 3002);
const API_KEY = process.env.SCRAPER_API_KEY;
const MAX_BODY = '1mb';

if (!API_KEY) {
  logger.error('SCRAPER_API_KEY is required. Refusing to start.');
  process.exit(1);
}

const crawlRequestSchema = z.object({
  siteId: z.string().uuid(),
  startUrl: z.string().url(),
  maxPages: z.number().int().positive().max(2000).default(100),
  webhookUrl: z.string().url(),
});

const app = express();

app.use(helmet());
app.use(express.json({ limit: MAX_BODY }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'agentdesk-scraper', uptime: process.uptime() });
});

app.use('/crawl', requireApiKey);
app.post('/crawl', (req, res) => {
  const parsed = crawlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  }

  const { siteId, startUrl, maxPages, webhookUrl } = parsed.data;
  const jobId = randomUUID();

  logger.info({ jobId, siteId, startUrl, maxPages }, 'crawl job accepted');

  // Detach the crawl from the request lifecycle — the webhook is the result channel.
  void runCrawl({
    siteId,
    startUrl,
    maxPages,
    webhookUrl,
    webhookApiKey: API_KEY,
  }).catch((err) => {
    logger.error({ jobId, siteId, err }, 'unhandled crawl error');
  });

  return res.status(202).json({ jobId, siteId, status: 'queued' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'agentdesk-scraper listening');
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
