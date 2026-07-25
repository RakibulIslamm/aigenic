# Aigenic

> An embeddable, multi-tenant AI customer support agent. Sign up, paste your URL, drop a one-line script on your site, and your visitors get a chat bubble trained on your entire website — with citations, tool use, and graceful escalation to a human. Works for any company: SaaS, e-commerce, marketing sites, agencies.

Built on the **Vercel AI SDK** + **OpenRouter** (model swappable; ships with `deepseek/deepseek-v4-flash` — see [`aigenic_app/lib/marketing.ts`](./aigenic_app/lib/marketing.ts), the single source for model/marketing facts), **Next.js 16** App Router, **Drizzle ORM** on Neon Postgres, and **Clerk** for auth. The chat widget is a ~12 KB (gzipped) Preact bundle that mounts inside a Shadow DOM. Crawling runs in a separate **Playwright** service on a Contabo VPS.

## Status

| Phase | Scope                                                                      | State |
| ----- | -------------------------------------------------------------------------- | ----- |
| 1     | Scaffold + Clerk auth + Drizzle schema + landing/dashboard shells          | ✅    |
| 2     | Site CRUD + 6-tab detail page + VPS scraper + webhook ingest               | ✅    |
| 3     | Embeddable `widget.js` (Preact + Shadow DOM) + chat endpoint with tool use | ✅    |
| 4     | Conversations browser + analytics + Stripe billing + plan-aware limits     | ✅    |
| 5     | Final UI polish (color picker, tool-call labels, active nav, copy buttons) | ✅    |
| ☐     | Production deploy (Vercel + Contabo) — see [Deployment](#deployment)       | ⏳    |

## What you get

- **One-line embed.** A single `<script>` tag, anywhere a script can load — Next, Astro, Webflow, Shopify, WordPress. Mounts in a Shadow DOM so your host CSS can't reach in.
- **Auto-crawl.** Point Aigenic at your URL and a separate Playwright service walks the site, respects `robots.txt`, dedupes by content hash, and streams articles back over a webhook. Static sites skip the Chromium startup tax.
- **Full-text search over your KB.** Postgres `tsvector` + GIN index, `plainto_tsquery` + `ts_rank` for ordering.
- **Streaming chat with tool use.** Custom SSE protocol (`meta | text | tool | error | done`). Three tools bound per request: `search_knowledge_base`, `get_article`, `escalate_to_human`. Tool calls render inline in the dashboard with friendly labels and a JSON drill-down.
- **Graceful escalation.** When the agent isn't sure it calls the escalate tool. Resend delivers the full transcript to the inbox set on the site — idempotent via DB constraint.
- **6-tab site detail.** Overview · Knowledge base (paginated, per-article re-scrape) · Conversations (status-filtered: All/Active/Escalated/Resolved, mark-as-resolved, transcript view, escalation panel) · Analytics (4 stats + 30-day chart + top topics) · Widget code (copy snippet + live `srcDoc` preview) · Settings (rename, escalation email, widget color picker, greeting, delete-with-confirm).
- **Plan-aware limits.** Free = 1 site / 30 conversations / month (hard cap). Starter ($19/mo) = 2 sites / 300 included + $0.15 per extra. Pro ($49/mo) = 5 sites / 1,000 included + $0.10 per extra. Hard cap enforced server-side on Free; paid plans allow overage. Stripe Checkout + Customer Portal wired through webhooks; the active subscription price id maps back to the plan. **Starter and Pro currently ship `comingSoon: true`** — the landing/billing pages show them as "Coming soon" and the upgrade buttons are disabled until the flags flip.
- **Stop-mid-crawl.** Big-site overrun? Hit the **Stop crawl** button — the optimistic UI flips immediately and the VPS aborts the in-flight job.

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          User's product website                            │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ <script src="https://aigenicapp.vercel.app/widget.js" data-site="…" async> │ │
│ │   • mounts Preact app inside Shadow DOM (~12 KB gzip)                │ │
│ │   • sessionStorage: visitorId + per-site conversationId                │ │
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

| Component           | Hosted on                          | Talks to                                                     |
| ------------------- | ---------------------------------- | ------------------------------------------------------------ |
| Next.js app         | Vercel                             | Neon, OpenRouter, Resend, Stripe, the VPS scraper            |
| Postgres (with FTS) | Neon                               | the Next.js app only                                         |
| Embeddable widget   | Served from Vercel `public/`       | `/api/widget/*` on the same Next.js app                      |
| Crawler             | Contabo VPS (Docker + Caddy + TLS) | Receives `POST /crawl`, posts back to `/api/scraper/webhook` |
| Auth                | Clerk                              | `clerkMiddleware()` in [`proxy.ts`](./aigenic_app/proxy.ts)  |
| Billing             | Stripe                             | Checkout sessions + webhooks → flips `users.plan`            |

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack, React 19.2)
- **Auth:** Clerk
- **DB:** Neon Postgres + Drizzle ORM (`postgres-js` driver) + a generated `tsvector` column for full-text KB search
- **AI:** Vercel AI SDK (`ai`, `@ai-sdk/openai`) pointed at OpenRouter — model is set as `SUPPORT_MODEL_ID` in [`lib/marketing.ts`](./aigenic_app/lib/marketing.ts) (currently `deepseek/deepseek-v4-flash`; swap for any OpenRouter model) and wired in [`lib/agent/model.ts`](./aigenic_app/lib/agent/model.ts). Three tools: `search_knowledge_base`, `get_article`, `escalate_to_human`. `stepCountIs(8)`, temp 0.3.
- **Widget:** Preact + Vite (IIFE bundle, ~12 KB gzipped, mounts in Shadow DOM, inlined CSS)
- **Crawler:** Playwright (headless Chromium) + `@mozilla/readability` + JSDOM + robots-parser, in [`vps-scraper/`](./vps-scraper/). Same-site BFS, sitemap-seeded, per-host rate limit, two-tier fetcher (plain `fetch` → escalate to Playwright only for JS shells), `AbortController`-based stop, exponential-backoff webhook delivery.
- **Email:** Resend (escalation transcripts, idempotent via `escalations` unique constraint)
- **Billing:** Stripe (Free / $19 Starter / $49 Pro, Checkout + Customer Portal; per-plan price IDs)
- **Charts:** Recharts (analytics tab)
- **UI:** shadcn/ui + Tailwind v4 + Lucide + Sonner (toasts) + Inter (body) / Space Grotesk (headings) / Geist Mono fonts
- **Package manager:** pnpm

## Feature tour

### Landing page (`/`)

Hero · social-proof strip · 6-feature grid · embed-code preview · vs-Intercom comparison · 3-tier pricing (Free / Starter / Pro) · FAQ accordion · final CTA. Dark theme, sticky header with `<Show when="signed-in">` to surface the **Open dashboard** button when authenticated.

### Dashboard (`/dashboard`)

Sticky top nav with active-state highlight (Sites / Billing). Sites grid shows plan-aware quota at the top, then a card per site with KB status badge, article + conversation counts, and quick links to **Widget code** + **Open**. Empty state on first run.

### Site detail (`/dashboard/sites/:id`)

6-tab nav with sliding active indicator:

| Tab                      | What's on it                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**             | 3 stats (articles, monthly conversations, escalation rate) + 5 most recent conversations.                                                                                                             |
| **Knowledge base**       | Paginated (25/page) article list with per-article re-scrape button. **Resync all** toggles to **Stop crawl** mid-flight.                                                                              |
| **Conversations**        | Status filter pill bar (All / Active / Escalated / Resolved), counts per status, click into transcript.                                                                                               |
| **Conversations** detail | Sticky transcript card with role-styled bubbles, inline collapsible tool calls (with friendly labels + icons + JSON input/output), visitor sidebar + escalation sidebar, **Mark as resolved** action. |
| **Analytics**            | 4 stats (monthly chats, avg resolution time, escalation rate, top-topics count) + 30-day Recharts area chart + top-5 topic list.                                                                      |
| **Widget code**          | Copyable `<script>` snippet, copyable site ID, live `srcDoc` iframe rendering the actual widget.                                                                                                      |
| **Settings**             | Site basics + widget appearance (bot name, greeting, **primary color with native picker swatch**) + danger-zone delete (type-to-confirm).                                                             |

### Billing (`/dashboard/billing`)

Plan + usage cards (sites used / monthly conversations vs. included allowance), success / cancelled / not-configured banners, three plan cards (Free / Starter / Pro) with **Current plan** / **Most popular** badges and **Upgrade to Starter** / **Upgrade to Pro** / **Manage subscription** actions. The conversations card shows overage in dollars when a paid plan exceeds its included count.

### Embeddable widget

Lives in [`widget/`](./widget/). Built via `pnpm build` → writes directly to `public/widget.js`. Bootstraps from a `<script data-site="…">` tag (or `window.AigenicConfig` fallback), opens a Shadow DOM, fetches `/api/widget/config?siteId=…`, streams chats over SSE, persists `visitorId` + `conversationId` in `sessionStorage`.

## Project layout

The repo is a **pnpm workspace** rooted at the top level:

```
package.json          # private workspace root — dev / build / typecheck / lint across packages
pnpm-workspace.yaml   # members: aigenic_app, widget
pnpm-lock.yaml        # single lockfile for both members
tsconfig.base.json    # shared strict compiler options; each package extends it
aigenic_app/          # the Next.js app (Vercel root directory)
widget/               # Preact widget — builds into aigenic_app/public/widget.js
vps-scraper/          # standalone: own lockfile + tsconfig (its Docker context is this dir)
```

`vps-scraper` is deliberately **outside** the workspace — the image build COPYs only
`vps-scraper/`, so it needs its own `pnpm-lock.yaml`. Its `pnpm-workspace.yaml` (`packages: []`)
marks it as its own pnpm root so `pnpm install` there doesn't climb up and install the
root workspace instead.

Inside `aigenic_app/`:

```
aigenic_app/
app/
  layout.tsx                       # ClerkProvider + dark theme + Sonner toaster
  page.tsx                         # Landing page (hero, features, vs-Intercom, pricing, FAQ)
  sign-in/[[...sign-in]]/          # Clerk catch-all
  sign-up/[[...sign-up]]/          # Clerk catch-all
  dashboard/
    layout.tsx                     # Authenticated shell — sticky nav with active highlight
    _components/top-nav.tsx        # Client nav with active-state matching
    page.tsx                       # Sites grid (plan-aware quota)
    actions.ts                     # All server actions, typed `ActionState` with fieldErrors + values
    billing/                       # Plan cards + usage + Upgrade / Manage portal
    sites/[siteId]/
      layout.tsx                   # Tab nav + site header + live crawl activity (SSE)
      page.tsx                     # Overview tab
      knowledge/                   # KB tab — paginated list, resync, stop crawl
      conversations/               # List + detail (transcript, tool-call accordions, sidebar)
      analytics/                   # 4 stats + recharts area chart + top topics
      widget/                      # Embed snippet + live srcDoc preview
      settings/                    # Edit form (color picker swatch) + danger-zone delete
  api/
    widget/chat/route.ts           # SSE streaming chat (CORS *), persists messages + tool calls
    widget/config/route.ts         # Public config the widget fetches on init
    scraper/webhook/route.ts       # Receives article/complete/stopped/error events from VPS
    stripe/checkout/route.ts       # Creates a Checkout session for Pro
    stripe/portal/route.ts         # Creates a Customer Portal session
    stripe/webhook/route.ts        # Subscription lifecycle → users.plan
lib/
  agent/                           # streamText agent + tools + system prompt + OpenRouter model
  auth/user.ts                     # Clerk → DB user sync
  billing/                         # Plan definitions + Stripe client
  email/resend.ts                  # Lazy Resend client
  scraper/client.ts                # Calls the VPS scraper (start + stop)
  sites/                           # Drizzle queries + Zod schemas + analytics aggregates
db/
  index.ts                         # Drizzle client (postgres-js, prepare:false for Neon pooler)
  schema.ts                        # All tables + relations + inferred types
drizzle/
  0000_*.sql                       # Initial schema migration
  0001_fts_index.sql               # tsvector + GIN/btree indexes
  0002_perf_indexes.sql            # Additional perf indexes
  0003_glossy_namora.sql           # Per-site btree indexes (resynced)
  0004_lean_roughhouse.sql         # crawl_runs table (manual-crawl quota tracking)
components/
  ui/                              # shadcn primitives
  skeletons.tsx                    # Section-level loading blocks
proxy.ts                           # clerkMiddleware() — protects /dashboard/*
next.config.ts                     # turbopack.root pinned to the workspace root
public/widget.js                   # Built widget bundle (~12 KB gzipped)
```

## Setup

### 1. Install

From the repo root — one install covers the app and the widget:

```bash
pnpm install
```

The scraper is a separate tree; install it only if you're working on it:

```bash
pnpm --dir vps-scraper install
```

Deps are caret-pinned; `pnpm-lock.yaml` is authoritative (use `--frozen-lockfile` in CI/Docker).

### 2. Environment

```bash
cd aigenic_app
cp .env.local.example .env.local
```

Minimum to boot the dashboard locally:

| Variable                                                | Where to get it                                      |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                                          | Neon Postgres (use the **pooled** connection string) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | [dashboard.clerk.com](https://dashboard.clerk.com)   |
| `NEXT_PUBLIC_APP_URL`                                   | `http://localhost:3000`                              |

To make the agent actually answer:

| Variable              | Notes                                            |
| --------------------- | ------------------------------------------------ |
| `OPENROUTER_API_KEY`  | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` (default)         |

To wire the crawler:

| Variable          | Notes                                                       |
| ----------------- | ----------------------------------------------------------- |
| `SCRAPER_API_URL` | `https://scraper.yourdomain.com` (HTTPS, no trailing slash) |
| `SCRAPER_API_KEY` | The shared secret you also set on the VPS                   |

To wire billing:

| Variable                  | Notes                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`       | `sk_live_...` or `sk_test_...`                                                                                   |
| `STRIPE_WEBHOOK_SECRET`   | `whsec_...` from the webhook endpoint in the Stripe dashboard                                                    |
| `STRIPE_STARTER_PRICE_ID` | `price_...` for the $19/mo Starter recurring price (optional — if unset, the Starter upgrade button is disabled) |
| `STRIPE_PRO_PRICE_ID`     | `price_...` for the $49/mo Pro recurring price (optional — if unset, the Pro upgrade button is disabled)         |

To wire escalation email: set `RESEND_API_KEY` (and optionally `RESEND_FROM_ADDRESS`).

> **⚠ Verify the sending domain in Resend before launch.** The from-address
> defaults to `Aigenic <agent@notifications.aigenic.app>`; whatever domain you
> use must show **Verified** under [Resend → Domains](https://resend.com/domains),
> or Resend rejects **every** escalation email. The failure is invisible to the
> visitor — delivery is confirmed against the API response, undelivered
> escalations appear as an amber _pending delivery_ badge on the site's
> Conversations tab, and the `retry-escalation-emails` Trigger.dev task
> re-sends them (bounded attempts) once the domain/key is fixed.

If your widget is hosted on a different origin from the dashboard, set `NEXT_PUBLIC_WIDGET_URL` so the **Widget code** tab renders the right snippet.

### 3. Apply migrations

```bash
pnpm db:generate   # only if you've changed db/schema.ts
pnpm db:migrate    # applies drizzle/*.sql to Neon
```

### 4. Build the widget once

```bash
pnpm --filter aigenic-widget build     # from the repo root
```

That writes `aigenic_app/public/widget.js`. Rebuild any time you change `widget/src/`.

### 5. Run

```bash
pnpm dev
```

Landing renders without auth. `/dashboard` redirects to Clerk sign-in. Add a site, wait for `kbStatus = ready` (site pages stream live crawl progress over SSE; the dashboard root refreshes every 15 s while a crawl is in flight), then drop the embed snippet from the **Widget code** tab onto a test page.

## Notes on Next.js 16

- **`middleware.ts` is now `proxy.ts`.** Clerk's `clerkMiddleware()` is unchanged. See [`proxy.ts`](./aigenic_app/proxy.ts).
- **All Request APIs are async** — `await cookies()`, `await params`, `await searchParams`.
- **Turbopack is default** for `dev` and `build`. `next.config.ts` pins `turbopack.root` to the **workspace root** — pnpm hoists real package files into `<repo>/node_modules/.pnpm`, and Turbopack refuses to resolve anything outside its root, so pointing it at `aigenic_app/` makes every dependency unresolvable.
- **`revalidateTag` requires a cacheLife profile** as the second argument now.

When in doubt, read `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.

## Scripts

From the **repo root** (these span packages):

| Script              | Purpose                                               |
| ------------------- | ----------------------------------------------------- |
| `pnpm dev`          | Next.js dev server (Turbopack)                        |
| `pnpm build`        | Widget bundle → app production build → scraper `tsc`  |
| `pnpm typecheck`    | `tsc --noEmit` across app, widget, scraper and tests  |
| `pnpm test`         | Vitest, once                                          |
| `pnpm test:watch`   | Vitest in watch mode                                  |
| `pnpm lint`         | ESLint over all three packages (one root flat config) |
| `pnpm lint:fix`     | Same, with `--fix` (import ordering is auto-fixable)  |
| `pnpm format`       | Prettier write                                        |
| `pnpm format:check` | Prettier check — the gate CI runs                     |

Lint and format are **root-only commands**. The root [`eslint.config.mjs`](./eslint.config.mjs)
covers `vps-scraper/src` too, so the scraper gets linted without ESLint entering its
dependency tree — its Docker build installs devDependencies, and everything installed
there ends up in the image.

From **`aigenic_app/`**:

| Script             | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `pnpm dev`         | Next.js dev server (Turbopack)                   |
| `pnpm build`       | Production build                                 |
| `pnpm start`       | Start the production server                      |
| `pnpm db:generate` | Generate a Drizzle migration from `db/schema.ts` |
| `pnpm db:migrate`  | Apply pending migrations to Neon                 |
| `pnpm db:push`     | Push schema directly — dev only                  |
| `pnpm db:studio`   | Open Drizzle Studio                              |

All scripts are prefixed with `cross-env MallocNanoZone=` — a macOS workaround for a malloc-zone issue that surfaces under Turbopack.

## Tests

Vitest, run from the repo root (`pnpm test`). Tests live in [`tests/`](./tests) rather than
beside the source, so no test file lands in a package's build inputs — the scraper's `tsc`
emits `src/**` into `dist/` and its Dockerfile copies `src`.

| Area                                                                        | What it pins                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`tests/scraper/url-utils`](./tests/scraper/url-utils.test.ts)              | URL normalization, same-site guard, skip filter — the crawler's core            |
| [`tests/app/plans`](./tests/app/plans.test.ts)                              | Every plan limit, as a table — a pricing edit can't silently change enforcement |
| [`tests/app/site-schemas`](./tests/app/site-schemas.test.ts)                | The validation boundary between the dashboard forms and the DB                  |
| [`tests/app/scraper-webhook`](./tests/app/scraper-webhook.test.ts)          | Auth gate, Zod contract with the VPS, and the `kbStatus` transition matrix      |
| [`tests/app/crawl-events`](./tests/app/crawl-events.test.ts)                | Snapshot→event diffing behind the SSE feed, and terminal-status detection       |
| [`tests/app/rescrape-quota`](./tests/app/rescrape-quota.test.ts)            | Manual re-crawl quota: claim-before-enqueue and rollback on failure             |
| [`tests/widget/render-rich-text`](./tests/widget/render-rich-text.test.tsx) | The widget's markdown/URL tokenizer, incl. paren balancing                      |

Everything is pure or mocked — no Postgres, no network, no browser. The database is faked
per test file; `server-only` and `next/cache` are stubbed at the resolver level in
[`vitest.config.ts`](./vitest.config.ts) because both throw outside a request scope.

## CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every PR and on pushes to
`main`, in two parallel jobs matching the two dependency trees:

- **app + widget** — frozen install → lint → format check → typecheck → **test** → widget build → app build
- **migrations · schema drift** — applies every committed migration to a throwaway Postgres
  service container, then fails if `drizzle-kit generate` produces anything, which means
  `db/schema.ts` was edited without generating the matching migration
- **vps-scraper** — frozen install → typecheck → build

The frozen install is deliberate: a drifted lockfile fails the job instead of silently
re-resolving. The app build gets a placeholder `DATABASE_URL` because `db/index.ts` throws
at import when it's unset; nothing connects during the build (every DB-touching route is
dynamic), so no real secret is involved.

## Deployment

The full punch-list:

1. **Push to GitHub**, then **import into Vercel**. Set the **Root Directory** to `aigenic_app/` and leave _"Include files outside the root directory"_ **enabled** (Vercel's default) — this is a pnpm workspace, so the build needs the root `pnpm-lock.yaml` and `tsconfig.base.json`. Vercel detects the workspace and runs the install from the repo root automatically.
2. Add every env var from `.env.local` to Vercel (Production + Preview).
3. **Clerk:** in the Clerk dashboard, add the Vercel domain to **Allowed Origins** and **Sign-in/Sign-up URLs**, switch the production instance to use the new domain.
4. **Stripe:** create the $19/mo Starter and $49/mo Pro recurring prices (each generates a `price_...` id — paste them into `STRIPE_STARTER_PRICE_ID` and `STRIPE_PRO_PRICE_ID`), then a webhook endpoint pointed at `https://your-app.vercel.app/api/stripe/webhook` listening to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`. The webhook handler reverse-looks-up the active price id to set the plan, so you don't need to repeat plan names anywhere.
5. **Migrations:** run `pnpm db:migrate` once against the production `DATABASE_URL`.
6. **Scraper:** SSH into the Contabo VPS and follow [vps-scraper/DEPLOY.md](./vps-scraper/DEPLOY.md). End-state: `https://scraper.yourdomain.com/health` returns `{"status":"ok"}` with a Let's Encrypt cert from Caddy. Set `SCRAPER_API_URL` and `SCRAPER_API_KEY` in Vercel to match.
7. **Smoke test on prod:**
   - Sign up via Clerk
   - Add a site (any kind — a marketing site, an e-commerce store, a docs site) and watch the KB land (the site page streams a live "X pages indexed so far" activity feed over SSE; KB status flips `pending → crawling → ready`)
   - Open the **Widget code** tab, copy the snippet, paste into a test HTML file, open in a browser
   - Chat — verify a friendly tool-call label appears (e.g. "Searched knowledge base") and text streams
   - Trigger an escalation ("I want to talk to a human about a refund") → check the inbox set as `escalationEmail`
   - **Mark as resolved** on the resulting conversation, confirm the status badge + filter count update
   - Click **Upgrade to Starter** (or **Pro**) → complete a Stripe Checkout in test mode → confirm `users.plan` flips to the right tier (the webhook reverse-looks-up the price id), the conversation hard cap disappears, and **Manage subscription** opens the Customer Portal

## Plan limits

| Plan        | Price       | Sites | Conversations / month | Overage                           |
| ----------- | ----------- | ----- | --------------------- | --------------------------------- |
| **Free**    | $0          | 1     | 30 (hard cap)         | —                                 |
| **Starter** | $19 / month | 2     | 300 included          | $0.15 per additional conversation |
| **Pro**     | $49 / month | 5     | 1,000 included        | $0.10 per additional conversation |

Starter and Pro are flagged `comingSoon` in [`lib/billing/plans.ts`](./aigenic_app/lib/billing/plans.ts) — the UI shows them as "Coming soon" with disabled upgrade buttons until the flags flip.

Site count is hard-enforced server-side in [`createSiteAction`](./aigenic_app/app/dashboard/actions.ts). Conversation limits behave per-plan: **Free** hard-caps in [`/api/widget/chat`](./aigenic_app/app/api/widget/chat/route.ts) (`enforceConversationLimit: true` in [`lib/billing/plans.ts`](./aigenic_app/lib/billing/plans.ts)), while **Starter** and **Pro** allow overage — new conversations keep flowing past the included count and are surfaced as a dollar amount on the Billing tab. The actual overage billing meter is not yet wired to Stripe; included counts and overage rates are stored on the plan for future metering. The Stripe webhook reverse-maps `items.data[0].price.id` → plan id via [`planForPriceId`](./aigenic_app/lib/billing/stripe.ts), so adding a fourth tier later is just a price-id + a plan entry.

---

This is Project 3 of an AI portfolio. Built in phases — each phase ends with a verification checkpoint.
