-- Reconciliation migration: brings the migration snapshot in line with
-- db/schema.ts, which now declares `content_tsv` (a `tsvector` customType) and
-- its GIN index instead of leaving them to hand-written SQL.
--
-- The column and index were originally created by 0001_fts_index.sql, so every
-- database that is up to date already has them — hence the IF NOT EXISTS
-- guards, which make this a no-op on an existing database while still being
-- correct on a fresh one. The expression is byte-identical to 0001's.
--
-- From here on, changes to this column come out of `pnpm db:generate`; nothing
-- about it needs to be hand-written again.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content", ''))) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_articles_tsv" ON "articles" USING gin ("content_tsv");
