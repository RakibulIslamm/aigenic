ALTER TABLE "articles" ADD COLUMN "source" text DEFAULT 'crawl' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "manual_document_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "crawl_access_key" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
CREATE INDEX "articles_manual_document_idx" ON "articles" USING btree ("site_id","manual_document_id") WHERE "articles"."manual_document_id" IS NOT NULL;