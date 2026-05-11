# AgentDesk

> An embeddable, multi-tenant AI customer support agent. Sign up, paste your URL, drop a one-line script on your site, and your visitors get a chat bubble trained on your docs.

Built on Claude Sonnet 4.6 (via OpenRouter) with the Vercel AI SDK, Next.js 16 App Router, Drizzle ORM on Neon Postgres, and Clerk for auth.

## Status

| Phase | Scope                                                                            | State |
| ----- | -------------------------------------------------------------------------------- | ----- |
| 1     | Scaffold + Clerk auth + Drizzle schema + landing/dashboard shells                | ✅    |
| 2     | Site CRUD + 5-tab detail page + VPS scraper service + webhook ingest             | ✅    |
| 3     | Embeddable `widget.js` + visitor chat endpoint with tool use                     | ⏳    |
| 4     | Conversations & escalations (email handoff via Resend)                           | ⏳    |
| 5     | Dashboard analytics                                                              | ⏳    |
| 6     | Stripe billing (Free vs Pro paywall)                                             | ⏳    |

> The scraper is a separate Express service that lives in [`../vps-scraper/`](../vps-scraper). The Next.js app calls it over HTTPS; it streams crawled articles back to [`/api/scraper/webhook`](./app/api/scraper/webhook/route.ts).

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack, React 19.2)
- **Auth:** Clerk (`clerkMiddleware()` wired in [`proxy.ts`](./proxy.ts) — Next.js 16's renamed middleware file)
- **DB:** Neon Postgres + Drizzle ORM (`postgres-js` driver)
- **AI:** Vercel AI SDK (`ai`, `@ai-sdk/openai`) pointed at OpenRouter, model `anthropic/claude-sonnet-4.6`
- **Files:** UploadThing
- **Email:** Resend
- **Jobs:** Trigger.dev
- **Billing:** Stripe
- **UI:** shadcn/ui (radix-luma) + Tailwind v4 + Lucide
- **Package manager:** pnpm

## Project layout

```
app/
  layout.tsx              # Root layout — wraps in <ClerkProvider> + dark theme
  page.tsx                # Landing page (hero, features, comparison, pricing, FAQ)
  sign-in/[[...sign-in]]/ # Clerk sign-in catch-all route
  sign-up/[[...sign-up]]/ # Clerk sign-up catch-all route
  dashboard/
    layout.tsx            # Authenticated shell with nav + UserButton
    page.tsx              # Sites grid (empty state until Phase 2)
components/ui/            # shadcn primitives (button, card, badge, separator)
db/
  index.ts                # Drizzle client (postgres-js, lazy-loaded by DATABASE_URL)
  schema.ts               # users, sites, articles, conversations, messages, escalations + relations
drizzle/
  0000_*.sql              # Initial schema migration (generated)
  0001_fts_index.sql      # Custom migration — tsvector + GIN index for KB search
proxy.ts                  # clerkMiddleware() — protects /dashboard/*
drizzle.config.ts         # drizzle-kit config (loads .env.local)
next.config.ts            # turbopack.root pinned to the app directory
```

## Setup

### 1. Install dependencies

```bash
pnpm install
```

This project uses **pnpm**. All dependencies are kept on caret ranges so `pnpm install` always resolves to the latest minor versions.

### 2. Create `.env.local`

Copy the example and fill in real values:

```bash
cp .env.local.example .env.local
```

The required values to get Phase 1 running are:

- `DATABASE_URL` — a Neon Postgres connection string (the pooled one).
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` — from your Clerk dashboard at [dashboard.clerk.com](https://dashboard.clerk.com).
- `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` for local dev.

The rest (OpenRouter, Resend, Stripe, UploadThing, Trigger.dev) are wired up in later phases. Leaving them blank is fine for Phase 1.

### 3. Run migrations against Neon

```bash
pnpm db:generate   # only needed if you change db/schema.ts
pnpm db:migrate    # applies drizzle/*.sql to your Neon database
```

`db:migrate` runs both `0000_*.sql` (schema) and `0001_fts_index.sql` (FTS column + GIN indexes on articles, plus btree indexes on `conversations.site_id` and `messages.conversation_id`).

Optional: `pnpm db:studio` opens Drizzle Studio for a quick look at the data.

### 4. Start the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The landing page renders without auth. Visiting `/dashboard` redirects to Clerk's sign-in.

## Notes on Next.js 16

This project targets Next.js 16, which moved the framework forward in a few breaking ways:

- **`middleware.ts` is now `proxy.ts`.** Same function, same matcher — Clerk's `clerkMiddleware()` works inside it unchanged. Live reference: [`proxy.ts`](./proxy.ts).
- **All Request APIs are async.** Anywhere we reach for `cookies()`, `headers()`, `params`, or `searchParams`, we `await` them.
- **Turbopack is the default** for both `dev` and `build`. We pin the workspace root in [`next.config.ts`](./next.config.ts) so multi-lockfile environments don't confuse the resolver.

When upgrading, always read the matching guide in `node_modules/next/dist/docs/01-app/02-guides/upgrading/` before writing code — the changes between minors are real.

## Scripts

| Script             | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `pnpm dev`         | Start the Next.js dev server (Turbopack)      |
| `pnpm build`       | Production build                              |
| `pnpm start`       | Start the production server                   |
| `pnpm lint`        | Run ESLint                                    |
| `pnpm db:generate` | Generate a Drizzle migration from `schema.ts` |
| `pnpm db:migrate`  | Apply pending migrations to Neon              |
| `pnpm db:push`     | Push schema directly (skip migrations) — dev only |
| `pnpm db:studio`   | Open Drizzle Studio                           |

## Deployment

Push to Vercel. Add the same env vars to the Vercel project, point the Clerk production instance at the deployed URL, and run `pnpm db:migrate` once against the production Neon database.

---

This is Project 3 of an AI portfolio. It's built in phases — each phase ends with a verification checkpoint before the next is scoped.
