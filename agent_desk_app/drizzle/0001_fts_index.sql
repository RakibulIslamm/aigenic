-- Full-text search support for the knowledge-base articles table.
-- A stored, generated tsvector keeps queries cheap and avoids manual triggers.

ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content", ''))
  ) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_articles_tsv" ON "articles" USING gin("content_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_articles_site" ON "articles"("site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_site" ON "conversations"("site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_messages_conversation" ON "messages"("conversation_id");
