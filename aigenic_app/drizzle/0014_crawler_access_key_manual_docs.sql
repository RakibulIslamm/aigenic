-- Idempotent on purpose (IF NOT EXISTS): this may be pasted into the Neon SQL
-- editor by hand before `pnpm db:migrate` ever runs, and the migrator must
-- then be able to re-apply it without failing.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'crawl' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "manual_document_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "crawl_access_key" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_manual_document_idx" ON "articles" USING btree ("site_id","manual_document_id") WHERE "articles"."manual_document_id" IS NOT NULL;
