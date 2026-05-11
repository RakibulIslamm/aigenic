# AgentDesk

> An embeddable, multi-tenant AI customer support agent. Sign up, paste your URL, drop a one-line script on your site, and your visitors get a chat bubble trained on your docs — with citations, tool use, and graceful escalation to a human.

Built on **Claude Sonnet 4.6** (via OpenRouter) with the Vercel AI SDK, **Next.js 16** App Router, **Drizzle ORM** on Neon Postgres, and **Clerk** for auth. The chat widget is a 9.5 KB Preact bundle that mounts inside a Shadow DOM. Crawling runs in a separate **Playwright** service on a Contabo VPS.

## Status

| Phase | Scope                                                                         | State |
| ----- | ----------------------------------------------------------------------------- | ----- |
| 1     | Scaffold + Clerk auth + Drizzle schema + landing/dashboard shells             | ✅    |
| 2     | Site CRUD + 5-tab detail page + VPS scraper + webhook ingest                  | ✅    |
| 3     | Embeddable `widget.js` (Preact + Shadow DOM) + chat endpoint with tool use    | ✅    |
| 4     | Conversations browser + analytics + Stripe billing + plan-aware limits        | ✅    |
| ☐     | Production deploy (Vercel + Contabo) — see [Deployment](#deployment)          | ⏳    |

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          User's product website                            │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ <script src="https://agentdesk.app/widget.js" data-site="…" async>   │ │
│ │   • mounts Preact app inside Shadow DOM (9.5 KB gzip)                │ │
│ │   • localStorage: visitorId + per-site conversationId                │ │
│ └──────────────────────────────┬───────────────────────────────────────┘ │
└────────────────────────────────┼───────────────────────────────────────────┘
                                 │ GET /api/widget/config?siteId
                                 │ POST /api/widget/chat   (SSE stream)
                                 ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  Vercel — Next.js 16 (this repo)                            │
        │ ┌─────────────────────┐ ┌─────────────────────────────────┐ │
        │ │ Dashboard           │ │ /api/widget/* (CORS *)          │ │
        │ │ /dashboard/*        │ │ /api/scraper/webhook            │ │
        │ │   sites · convos    │ │ /api/stripe/{checkout,webhook}  │ │
        │ │   analytics · billing│ │                                 │ │
        │ └─────────────────────┘ └─────────────────────────────────┘ │
        │            ▲                              ▲                 │
        │  Clerk (auth)                  AI SDK + OpenRouter          │
        │  Drizzle ORM ◀─── Neon Postgres ◀─────── tool calls         │
        │  Resend (escalation email)                                  │
        │  Stripe (Pro subscriptions)                                 │
        └─────────────┬─────────────────────────────────────┬─────────┘
                      │                                     │
            ┌─────────▼──────────┐               ┌──────────▼─────────┐
            │ Neon Postgres      │               │ Contabo VPS        │
            │ users, sites,      │               │ vps-scraper/       │
            │ articles + tsvec,  │               │ • Express + helmet │
            │ conversations,     │   webhook ─►  │ • Playwright       │
            │ messages,          │               │ • Readability      │
            │ escalations        │               │ • robots-parser    │
            └────────────────────┘               │ Caddy → HTTPS      │
                                                 └────────────────────┘
```

**What runs where**

| Component               | Hosted on                           | Talks to                                                |
| ----------------------- | ----------------------------------- | ------------------------------------------------------- |
| Next.js app             | Vercel                              | Neon, OpenRouter, Resend, Stripe, the VPS scraper      |
| Postgres (with FTS)     | Neon                                | the Next.js app only                                    |
| Embeddable widget       | Served from Vercel `public/`        | `/api/widget/*` on the same Next.js app                 |
| Crawler                 | Contabo VPS (Docker + Caddy + TLS)  | Receives `POST /crawl`, posts back to `/api/scraper/webhook` |
| Auth                    | Clerk                               | `clerkMiddleware()` in [`proxy.ts`](./proxy.ts)         |
| Billing                 | Stripe                              | Checkout sessions + webhooks → flips `users.plan`       |

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack, React 19.2)
- **Auth:** Clerk
- **DB:** Neon Postgres + Drizzle ORM (`postgres-js` driver) + a generated `tsvector` column for full-text KB search
- **AI:** Vercel AI SDK (`ai`, `@ai-sdk/openai`) pointed at OpenRouter, model `anthropic/claude-sonnet-4.6`, with three tools: `search_knowledge_base`, `get_article`, `escalate_to_human`
- **Widget:** Preact + Vite (IIFE bundle, ~9.5 KB gzipped, mounts in Shadow DOM)
- **Crawler:** Playwright (headless Chromium) + `@mozilla/readability` + JSDOM + robots-parser, in [`../vps-scraper/`](../vps-scraper)
- **Email:** Resend (escalation transcripts)
- **Billing:** Stripe (Free vs $49/mo Pro, customer portal for cancellation)
- **Charts:** Recharts (analytics tab)
- **UI:** shadcn/ui + Tailwind v4 + Lucide
- **Package manager:** pnpm

## Project layout

```
app/
  layout.tsx                       # ClerkProvider + dark theme + Sonner toaster
  page.tsx                         # Landing page (hero, features, pricing, FAQ)
  sign-in/[[...sign-in]]/          # Clerk catch-all
  sign-up/[[...sign-up]]/          # Clerk catch-all
  dashboard/
    layout.tsx                     # Authenticated shell — Sites, Billing nav
    page.tsx                       # Sites grid (plan-aware quota)
    actions.ts                     # All server actions (create/update/delete site, rescrape, mark resolved)
    billing/page.tsx               # Plan cards + usage + Upgrade / Manage portal
    sites/[siteId]/
      layout.tsx                   # Tab nav + site header
      page.tsx                     # Overview tab
      knowledge/                   # KB tab (article list, resync)
      conversations/               # List + detail (transcript, tool-call accordions, sidebar)
      analytics/                   # 4 stats + recharts area chart + top topics
      widget/                      # Embed snippet + live srcDoc preview
      settings/                    # Edit form + danger-zone delete
  api/
    widget/chat/route.ts           # SSE streaming chat (CORS *), persists messages + tool calls
    widget/config/route.ts         # Public config the widget fetches on init
    scraper/webhook/route.ts       # Receives article/complete/error events from VPS
    stripe/checkout/route.ts       # Creates a Checkout session for Pro
    stripe/portal/route.ts         # Creates a Customer Portal session
    stripe/webhook/route.ts        # Subscription lifecycle → users.plan
lib/
  agent/                           # streamText agent + tools + system prompt + OpenRouter model
  auth/user.ts                     # Clerk → DB user sync
  billing/                         # Plan definitions + Stripe client
  email/resend.ts                  # Lazy Resend client
  scraper/client.ts                # Calls the VPS scraper
  sites/                           # Drizzle queries + Zod schemas
db/
  index.ts                         # Drizzle client (postgres-js)
  schema.ts                        # All tables + relations + inferred types
drizzle/
  0000_*.sql                       # Initial schema migration
  0001_fts_index.sql               # tsvector + GIN/btree indexes
proxy.ts                           # clerkMiddleware() — protects /dashboard/*
next.config.ts                     # turbopack.root pinned to the app directory
public/widget.js                   # Built widget bundle (9.5 KB gzipped)
```

## Setup

### 1. Install

```bash
pnpm install
```

Caret-ranged deps — `pnpm install` always pulls the latest minor.

### 2. Environment

```bash
cp .env.local.example .env.local
```

Minimum to boot the dashboard locally:

| Variable                          | Where to get it                                        |
| --------------------------------- | ------------------------------------------------------ |
| `DATABASE_URL`                    | Neon Postgres (use the **pooled** connection string)   |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | [dashboard.clerk.com](https://dashboard.clerk.com)     |
| `NEXT_PUBLIC_APP_URL`             | `http://localhost:3000`                                |

To make the agent actually answer:

| Variable                  | Notes                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`      | [openrouter.ai/keys](https://openrouter.ai/keys)                     |
| `OPENROUTER_BASE_URL`     | `https://openrouter.ai/api/v1` (default)                             |

To wire the crawler:

| Variable          | Notes                                            |
| ----------------- | ------------------------------------------------ |
| `SCRAPER_API_URL` | `https://scraper.yourdomain.com` (HTTPS, no trailing slash) |
| `SCRAPER_API_KEY` | The shared secret you also set on the VPS       |

To wire billing:

| Variable                  | Notes                                                        |
| ------------------------- | ------------------------------------------------------------ |
| `STRIPE_SECRET_KEY`       | `sk_live_...` or `sk_test_...`                               |
| `STRIPE_WEBHOOK_SECRET`   | `whsec_...` from the webhook endpoint in the Stripe dashboard |
| `STRIPE_PRO_PRICE_ID`     | `price_...` for the $49/mo recurring price                   |

To wire escalation email: set `RESEND_API_KEY` (and optionally `RESEND_FROM_ADDRESS`).

### 3. Apply migrations

```bash
pnpm db:generate   # only if you've changed db/schema.ts
pnpm db:migrate    # applies drizzle/*.sql to Neon
```

### 4. Run

```bash
pnpm dev
```

Landing renders without auth. `/dashboard` redirects to Clerk sign-in. Add a site, wait for `kbStatus = ready`, then drop the embed snippet from the **Widget code** tab onto a test page.

## Notes on Next.js 16

- **`middleware.ts` is now `proxy.ts`.** Clerk's `clerkMiddleware()` is unchanged. See [`proxy.ts`](./proxy.ts).
- **All Request APIs are async** — `await cookies()`, `await params`, `await searchParams`.
- **Turbopack is default** for `dev` and `build`. `next.config.ts` pins `turbopack.root` so a multi-lockfile environment doesn't confuse the resolver.
- **`revalidateTag` requires a cacheLife profile** as the second argument now.

When in doubt, read `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.

## Scripts

| Script             | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `pnpm dev`         | Next.js dev server (Turbopack)                   |
| `pnpm build`       | Production build                                 |
| `pnpm start`       | Start the production server                      |
| `pnpm lint`        | ESLint                                           |
| `pnpm db:generate` | Generate a Drizzle migration from `db/schema.ts` |
| `pnpm db:migrate`  | Apply pending migrations to Neon                 |
| `pnpm db:push`     | Push schema directly — dev only                  |
| `pnpm db:studio`   | Open Drizzle Studio                              |

## Deployment

The full punch-list:

1. **Push to GitHub**, then **import into Vercel**. Set the project root to `agent_desk_app/`.
2. Add every env var from `.env.local` to Vercel (Production + Preview).
3. **Clerk:** in the Clerk dashboard, add the Vercel domain to **Allowed Origins** and **Sign-in/Sign-up URLs**, switch the production instance to use the new domain.
4. **Stripe:** create the $49/mo recurring price, then a webhook endpoint pointed at `https://your-app.vercel.app/api/stripe/webhook` listening to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. **Migrations:** run `pnpm db:migrate` once against the production `DATABASE_URL`.
6. **Scraper:** SSH into the Contabo VPS and follow [../vps-scraper/DEPLOY.md](../vps-scraper/DEPLOY.md). End-state: `https://scraper.yourdomain.com/health` returns `{"status":"ok"}` with a Let's Encrypt cert from Caddy. Set `SCRAPER_API_URL` and `SCRAPER_API_KEY` in Vercel to match.
7. **Smoke test on prod:**
   - Sign up via Clerk
   - Add a small docs site, watch the KB land
   - Copy the embed code, paste into a test HTML file, open in a browser
   - Chat — verify the tool pill appears and text streams
   - Trigger an escalation ("I want to talk to a human about a refund") → check the inbox set as `escalationEmail`
   - Click **Upgrade to Pro** → complete a Stripe Checkout in test mode → confirm `users.plan` flips to `pro` and the conversation cap disappears

## Plan limits

| Plan | Sites | Conversations / month |
| ---- | ----- | --------------------- |
| Free | 1     | 100                   |
| Pro  | 5     | Unlimited             |

Both limits are enforced server-side: site count in [`createSiteAction`](./app/dashboard/actions.ts), conversation count in [`/api/widget/chat`](./app/api/widget/chat/route.ts) before a new conversation is created. The Stripe webhook drives the user's `plan` column.

---

This is Project 3 of an AI portfolio. Built in phases — each phase ends with a verification checkpoint.
