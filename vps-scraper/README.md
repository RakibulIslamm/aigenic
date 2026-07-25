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
   {
     "event": "article",
     "siteId": "…",
     "article": { "title": "…", "content": "…", "sourceUrl": "…" }
   }
   ```
4. When the crawl finishes (or hits `maxPages`), it POSTs a final event:
   ```json
   { "event": "complete", "siteId": "…", "totalPages": 42 }
   ```
5. On fatal error, it sends `{ "event": "error", "siteId": "…", "error": "…" }` instead.

The crawler stays within the start URL's hostname, respects `robots.txt`, and runs at most three pages concurrently.

## Endpoints

| Method | Path      | Auth        | Description                                                         |
| ------ | --------- | ----------- | ------------------------------------------------------------------- |
| `GET`  | `/health` | none        | Liveness check. Returns `{ status: "ok" }`.                         |
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
curl http://localhost:3007/health
# {"status":"ok","service":"aigenic-scraper","uptime":1.23}

curl -X POST http://localhost:3007/crawl \
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

The compose file binds the container to `127.0.0.1:3007` only — pair with Caddy or Nginx for TLS. See [DEPLOY.md](./DEPLOY.md) for a full Contabo walkthrough.

### Running the image directly

`docker run aigenic-scraper` on its own **exits immediately** with
`SCRAPER_API_KEY is not set. Refusing to start.` — that's intentional, not a broken image:
the service will not boot as an unauthenticated crawler. `docker compose up` passes the key
from `vps-scraper/.env`; a bare `docker run` does not, so pass it yourself:

```bash
docker build -t aigenic-scraper .          # note the -t; without it the image is <none>
docker run --rm -e SCRAPER_API_KEY=local-test -p 127.0.0.1:3007:3007 aigenic-scraper
curl -s http://127.0.0.1:3007/health        # {"status":"ok","service":"aigenic-scraper",…}
```

`POST /crawl` returns `401` without a matching `X-API-Key` header and `400` on an invalid
payload — a quick way to confirm auth is wired before pointing the app at it.

## SSRF protection

The crawler fetches URLs a tenant typed into a form, so without a guard this service is a
proxy into its own network — and whatever it fetches gets ingested as an "article" and
read back out through the public support widget. `src/ssrf-guard.ts` enforces three
checks on every outbound request (`fetcher.ts`, `crawler.ts` robots.txt, `sitemap.ts`):

1. **Name check** — rejects `localhost`, `*.local` / `*.internal` / `*.localhost` /
   `*.home.arpa`, bare single-label hostnames, non-`http(s)` schemes, and any IP literal
   outside the public unicast range (loopback, RFC 1918, link-local `169.254/16`,
   CGNAT `100.64/10`, multicast, IPv4-mapped IPv6 forms of all of the above).
2. **Connect-time DNS check** — a custom undici `lookup` validates the address _inside_
   the socket connect, so a hostname that re-resolves to a private IP between check and
   connect (DNS rebinding) still can't be reached.
3. **Per-hop redirect check** — `redirect: 'manual'` with the full guard re-run on every
   `Location`, so a public page can't 302 into the metadata endpoint.

A blocked URL is logged (`ssrf-guard: blocked …`) and skipped; a blocked **start** URL
fails the crawl with an `error` webhook. **Chromium is the one gap** — it does its own
DNS and redirects; see the egress-filtering note at the top of `docker-compose.yml` for
the network-level backstop, which is a manual step on the host.

## Project layout

```
src/
  index.ts            HTTP server, API-key middleware, job acceptance
  crawler.ts          Playwright-driven BFS crawl with concurrency + robots.txt
  content-extractor.ts Readability + JSDOM extraction, internal-link discovery
  ssrf-guard.ts       Blocks non-public hosts on every outbound fetch
  webhook.ts          Outbound webhook delivery with exponential-backoff retry
  logger.ts           pino logger (pretty in dev, JSON in prod)
Dockerfile            Multi-stage build on top of mcr.microsoft.com/playwright
docker-compose.yml    Single-service compose with shm_size + memory limits
DEPLOY.md             VPS deployment guide (Contabo + Caddy)
```

## Environment variables

| Variable             | Required | Default                                                | Notes                                                           |
| -------------------- | -------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| `SCRAPER_API_KEY`    | yes      | —                                                      | Shared secret with the Next.js app. Refuse to start without it. |
| `PORT`               | no       | `3007`                                                 | Express bind port.                                              |
| `LOG_LEVEL`          | no       | `info`                                                 | Pino log level.                                                 |
| `SCRAPER_USER_AGENT` | no       | `AigenicBot/0.1 (+https://aigenic.app/bot)`            | What the crawler advertises in HTTP and robots.txt lookups.     |
| `NODE_ENV`           | no       | `production` in container, `development` in `pnpm dev` | Switches pino between JSON and pretty.                          |

## License

MIT — for use inside the Aigenic project.
