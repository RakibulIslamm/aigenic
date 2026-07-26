-- Per-site ownership verification + the crawl credential it unlocks.
--
-- Hand-edited from the generated version, which emitted a bare
-- `ADD COLUMN ... NOT NULL` and would have failed on every existing row.
-- The three-step add / backfill / constrain below is the safe equivalent:
-- the columns have no database-level DEFAULT (application inserts supply
-- them via `$defaultFn(randomToken)` in db/schema.ts), so the backfill has
-- to generate the values itself.
--
-- `gen_random_uuid()` is core Postgres (13+) and CSPRNG-backed; stripping the
-- dashes yields the same 32-hex-character shape `randomToken()` produces, so
-- rows created before and after this migration are indistinguishable. It is
-- volatile, so each row gets its own value rather than one shared secret.

ALTER TABLE "sites" ADD COLUMN "verification_token" text;--> statement-breakpoint
UPDATE "sites" SET "verification_token" = replace(gen_random_uuid()::text, '-', '') WHERE "verification_token" IS NULL;--> statement-breakpoint
ALTER TABLE "sites" ALTER COLUMN "verification_token" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "sites" ADD COLUMN "verification_method" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint

ALTER TABLE "sites" ADD COLUMN "crawl_secret" text;--> statement-breakpoint
UPDATE "sites" SET "crawl_secret" = replace(gen_random_uuid()::text, '-', '') WHERE "crawl_secret" IS NULL;--> statement-breakpoint
ALTER TABLE "sites" ALTER COLUMN "crawl_secret" SET NOT NULL;
