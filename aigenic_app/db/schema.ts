import {
  customType,
  integer,
  pgTable,
  uniqueIndex,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql, type SQL } from 'drizzle-orm';

/**
 * Postgres `tsvector`, which Drizzle has no built-in column type for.
 * Declaring it here (instead of only in hand-written SQL) makes the schema the
 * single source of truth: `drizzle-kit generate` emits the generated column
 * and its GIN index like any other, and the column is visible to queries as
 * `articles.contentTsv`.
 *
 * It is never written directly — Postgres computes it — so the type only has
 * to describe what comes back out.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const users = pgTable('users', {
  id: text('id').primaryKey(), // Clerk user ID
  email: text('email').notNull(),
  plan: text('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    domain: text('domain').notNull(),
    escalationEmail: text('escalation_email').notNull(),
    widgetConfig: jsonb('widget_config').$type<{
      primaryColor: string;
      greeting: string;
      botName: string;
    }>(),
    kbStatus: text('kb_status').notNull().default('pending'),
    kbLastSyncedAt: timestamp('kb_last_synced_at'),
    /**
     * The article generation this site's knowledge base **serves**. Every read
     * path filters to it, so a crawl in progress is invisible to visitors and
     * to the dashboard until it succeeds. See `lib/sites/generations.ts`.
     */
    activeGeneration: integer('active_generation').notNull().default(0),
    /**
     * The generation currently being **written** — bumped on every dispatch.
     * Equal to `activeGeneration` when no crawl is in flight. It's what makes
     * a superseded crawl's late webhooks identifiable, and therefore ignorable.
     */
    crawlGeneration: integer('crawl_generation').notNull().default(0),
    /**
     * When the current crawl was claimed (set by the dispatch that flips
     * `kbStatus` to `crawling`, and by the enqueue that flips it to
     * `pending`). The watchdog task uses it to detect crawls that died
     * without a terminal webhook. Null once terminal state is reached is NOT
     * guaranteed — always interpret it together with `kbStatus`.
     */
    crawlStartedAt: timestamp('crawl_started_at'),
    /**
     * Trigger.dev run id of a queued-but-not-yet-running crawl task, so Stop
     * can cancel the queue entry instead of letting it crawl a cancelled job.
     * Cleared when the dispatch claims the crawl (or Stop cancels it).
     */
    pendingCrawlRunId: text('pending_crawl_run_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('sites_user_id_idx').on(t.userId)],
);

export const articles = pgTable(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .references(() => sites.id, { onDelete: 'cascade' })
      .notNull(),
    sourceUrl: text('source_url'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    /**
     * Which crawl produced this row. Only rows matching the site's
     * `activeGeneration` are ever read; the rest are staging for an in-flight
     * crawl, or leftovers a failed one didn't get to promote.
     *
     * Default 0 so every row that existed before generations were introduced
     * is the active generation of a site whose counter also starts at 0.
     */
    crawlGeneration: integer('crawl_generation').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /**
     * Stored generated tsvector over title + content — what
     * `search_knowledge_base` matches against. Postgres maintains it on every
     * insert/update, so there is no trigger to keep in sync and nothing to
     * write from application code (Drizzle omits generated columns from
     * `$inferInsert`).
     *
     * The expression is kept byte-identical to the original hand-written
     * migration (`0001_fts_index.sql`) so it describes the column that is
     * already live, rather than proposing a different one.
     */
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content", ''))`,
    ),
  },
  (t) => [
    index('articles_site_id_idx').on(t.siteId),
    index('articles_site_id_created_at_idx').on(t.siteId, t.createdAt),
    // Matches the index name created by 0001_fts_index.sql.
    index('idx_articles_tsv').using('gin', t.contentTsv),
    /**
     * One row per URL per crawl. The generation has to be part of the key:
     * during a re-crawl the staging rows legitimately carry the same URLs as
     * the live ones, so `(site_id, source_url)` alone would collide.
     *
     * This is what makes a redelivered `article` webhook an upsert instead of
     * a duplicate. Rows with a null `source_url` don't participate (Postgres
     * treats nulls as distinct) — the scraper always sends one.
     */
    uniqueIndex('articles_site_generation_source_url_key').on(
      t.siteId,
      t.crawlGeneration,
      t.sourceUrl,
    ),
  ],
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .references(() => sites.id, { onDelete: 'cascade' })
      .notNull(),
    visitorId: text('visitor_id').notNull(),
    visitorEmail: text('visitor_email'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('conversations_site_id_created_at_idx').on(t.siteId, t.createdAt),
    index('conversations_site_id_visitor_id_idx').on(t.siteId, t.visitorId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('messages_conversation_id_created_at_idx').on(t.conversationId, t.createdAt),
  ],
);

export const crawlRuns = pgTable(
  'crawl_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .references(() => sites.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    // 'manual' = user-initiated rescrape, 'scheduled' = Trigger.dev daily job.
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('crawl_runs_user_id_kind_created_at_idx').on(t.userId, t.kind, t.createdAt),
    index('crawl_runs_site_id_created_at_idx').on(t.siteId, t.createdAt),
  ],
);

export const escalations = pgTable(
  'escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .references(() => conversations.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    reason: text('reason').notNull(),
    /**
     * When the owner-notification email was actually accepted by Resend.
     * Null means the owner has NOT heard about this escalation yet — the
     * retry task keeps re-sending (bounded by `emailAttempts`) and the
     * dashboard surfaces the row as pending until this is set.
     */
    emailSentAt: timestamp('email_sent_at'),
    /**
     * Real delivery attempts (Resend was called), not wishes: a missing
     * API key doesn't count, so the bound can't be burned before the key
     * is even configured.
     */
    emailAttempts: integer('email_attempts').notNull().default(0),
    emailLastAttemptAt: timestamp('email_last_attempt_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    // The retry task's scan: pending rows only, oldest first. Partial so the
    // index stays as small as the backlog, not the table.
    index('escalations_email_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.emailSentAt} IS NULL`),
  ],
);

export const rateLimits = pgTable('rate_limits', {
  /**
   * Scope + window label + identity in one string, e.g. `chat:ip:10s:1.2.3.4`.
   * The window length must be part of the key — two limiters over the same
   * identity with different windows are different counters.
   */
  key: text('key').primaryKey(),
  /**
   * When the current fixed window opened. The upsert in `lib/ratelimit.ts`
   * resets it (and the count) in place once the window has elapsed, so each
   * key holds exactly one row for its lifetime — no per-window row growth.
   */
  windowStart: timestamp('window_start').defaultNow().notNull(),
  count: integer('count').notNull().default(1),
});

export const usersRelations = relations(users, ({ many }) => ({
  sites: many(sites),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  user: one(users, {
    fields: [sites.userId],
    references: [users.id],
  }),
  articles: many(articles),
  conversations: many(conversations),
}));

export const articlesRelations = relations(articles, ({ one }) => ({
  site: one(sites, {
    fields: [articles.siteId],
    references: [sites.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  site: one(sites, {
    fields: [conversations.siteId],
    references: [sites.id],
  }),
  messages: many(messages),
  escalation: one(escalations),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const escalationsRelations = relations(escalations, ({ one }) => ({
  conversation: one(conversations, {
    fields: [escalations.conversationId],
    references: [conversations.id],
  }),
}));

export const crawlRunsRelations = relations(crawlRuns, ({ one }) => ({
  site: one(sites, {
    fields: [crawlRuns.siteId],
    references: [sites.id],
  }),
  user: one(users, {
    fields: [crawlRuns.userId],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;
export type CrawlRun = typeof crawlRuns.$inferSelect;
export type NewCrawlRun = typeof crawlRuns.$inferInsert;
