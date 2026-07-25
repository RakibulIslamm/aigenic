ALTER TABLE "sites" ADD COLUMN "crawl_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "pending_crawl_run_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;