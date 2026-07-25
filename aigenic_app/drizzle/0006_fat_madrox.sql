-- Crawl generations: let a re-crawl build a new knowledge base alongside the
-- live one and swap only on success. See lib/sites/generations.ts.
--
-- Defaults of 0 are what make this safe to apply to a live database: every
-- existing article becomes generation 0, and every site's active_generation is
-- 0, so the whole KB stays readable the moment the migration lands. The first
-- crawl after deploy claims generation 1.

ALTER TABLE "articles" ADD COLUMN "crawl_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "active_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "crawl_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- The unique index below cannot be created while duplicates exist, and they
-- can: before this migration nothing stopped two crawled pages sharing a
-- source_url (two URLs resolving to one <link rel="canonical">, or a webhook
-- redelivery). Keep the oldest row of each group — it is the one the FTS index
-- and any existing conversation already refer to.
--
-- Nulls are excluded deliberately: Postgres treats them as distinct in a unique
-- index, so null-source_url rows never collide and must not be deleted here.
DELETE FROM "articles" a
USING "articles" b
WHERE a."source_url" IS NOT NULL
  AND a."site_id" = b."site_id"
  AND a."crawl_generation" = b."crawl_generation"
  AND a."source_url" = b."source_url"
  AND (a."created_at", a."id") > (b."created_at", b."id");--> statement-breakpoint

CREATE UNIQUE INDEX "articles_site_generation_source_url_key" ON "articles" USING btree ("site_id","crawl_generation","source_url");
