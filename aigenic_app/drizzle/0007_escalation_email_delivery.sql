ALTER TABLE "escalations" ADD COLUMN "email_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "email_last_attempt_at" timestamp;--> statement-breakpoint
CREATE INDEX "escalations_email_pending_idx" ON "escalations" USING btree ("created_at") WHERE "escalations"."email_sent_at" IS NULL;