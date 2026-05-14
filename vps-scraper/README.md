# Aigenic Scraper

> Standalone HTTP service that crawls a tenant's site with Playwright, extracts clean article content with Mozilla Readability, and streams results back to the Aigenic Next.js app via webhook.

This is **not** part of the Next.js app — it's a small Express service designed to run on a VPS (Contabo, Hetzner, anywhere with Docker). The Next.js app talks to it over HTTPS using an API key.

```
┌────────────────────┐                ┌──────────────────────┐
│  Aigenic (Vercel)    │  POST /crawl  │  vps-scraper         │
│                     │ ─────────────▶│  (this service)      │
│  /api/scraper/      │               │                      │
│   webhook  ◀────────│   article…    │  Playwright + JSDOM  │
│                     │   complete    │                      │
└────────────────────┘                └──────────────────────┘
```

## How it works

1. The Next.js app POSTs `/crawl` with `{ siteId, startUrl, maxPages, webhookUrl }` and the `X-API-Key` header.
2. The service responds `202 Accepted` with a `jobId` and starts crawling in the background.
3. For every page it can extract a readable article from, it POSTs back to `webhookUrl`:
   ```json
   { "event": "article", "siteId": "…", "article": { "title": "…", "content": "…", "sourceUrl": "…" } }
   ```
4. When the crawl finishes (or hits `maxPages`), it POSTs a final event:
   ```json
   { "event": "complete", "siteId": "…", "totalPages": 42 }
   ```
5. On fatal error, it sends `{ "event": "error", "siteId": "…", "error": "…" }` instead.

The crawler stays within the start URL's hostname, respects `robots.txt`, and runs at most three pages concurrently.

## Endpoints

| Method | Path     | Auth        | Description                                          |
| ------ | -------- | ----------- | ---------------------------------------------------- |
| `GET`  | `/health` | none        | Liveness check. Returns `{ status: "ok" }`.          |
| `POST` | `/crawl`  | `X-API-Key` | Enqueue a crawl. Returns `202 { jobId, siteId, status: "queued" }`. |

### Request shape

```http
POST /crawl
Content-Type: application/json
X-API-Key: <SCRAPER_API_KEY>

{
  "siteId":     "11111111-2222-3333-4444-555555555555",
  "startUrl":   "https://docs.example.com",
  "maxPages":   100,
  "webhookUrl": "https://aigenic.app/api/scraper/webhook"
}
```

## Run it locally

```bash
pnpm install
pnpm playwright:install    # downloads Chromium + system deps
cp .env.example .env       # then set SCRAPER_API_KEY
pnpm dev                   # tsx watch — restarts on save
```

Smoke test:

```bash
curl http://localhost:3001/health
# {"status":"ok","service":"aigenic-scraper","uptime":1.23}

curl -X POST http://localhost:3001/crawl \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $SCRAPER_API_KEY" \
  -d '{
    "siteId":"00000000-0000-0000-0000-000000000000",
    "startUrl":"https://example.com",
    "maxPages":5,
    "webhookUrl":"https://webhook.site/your-test-bin"
  }'
```

## Run it in Docker

```bash
export SCRAPER_API_KEY="$(openssl rand -hex 32)"
docker compose up -d --build
docker compose logs -f
```

The compose file binds the container to `127.0.0.1:3001` only — pair with Caddy or Nginx for TLS. See [DEPLOY.md](./DEPLOY.md) for a full Contabo walkthrough.

## Project layout

```
src/
  index.ts            HTTP server, API-key middleware, job acceptance
  crawler.ts          Playwright-driven BFS crawl with concurrency + robots.txt
  content-extractor.ts Readability + JSDOM extraction, internal-link discovery
  webhook.ts          Outbound webhook delivery with exponential-backoff retry
  logger.ts           pino logger (pretty in dev, JSON in prod)
Dockerfile            Multi-stage build on top of mcr.microsoft.com/playwright
docker-compose.yml    Single-service compose with shm_size + memory limits
DEPLOY.md             VPS deployment guide (Contabo + Caddy)
```

## Environment variables

| Variable             | Required | Default                                       | Notes                                                              |
| -------------------- | -------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `SCRAPER_API_KEY`    | yes      | —                                             | Shared secret with the Next.js app. Refuse to start without it.   |
| `PORT`               | no       | `3001`                                        | Express bind port.                                                 |
| `LOG_LEVEL`          | no       | `info`                                        | Pino log level.                                                    |
| `SCRAPER_USER_AGENT` | no       | `AigenicBot/0.1 (+https://aigenic.app/bot)`     | What the crawler advertises in HTTP and robots.txt lookups.       |
| `NODE_ENV`           | no       | `production` in container, `development` in `pnpm dev` | Switches pino between JSON and pretty.                  |

## License

MIT — for use inside the Aigenic project.
