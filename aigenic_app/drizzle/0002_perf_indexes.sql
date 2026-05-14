-- Performance indexes for hot lookup paths.
--
--   sites.user_id          → every dashboard load filters by it (listSitesForUser)
--   conversations.visitor_id → conversation detail aggregates per-visitor stats
--   users.stripe_customer_id → Stripe webhook fallback lookup when metadata is missing

CREATE INDEX IF NOT EXISTS "idx_sites_user" ON "sites"("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_conversations_visitor" ON "conversations"("visitor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_users_stripe_customer" ON "users"("stripe_customer_id");
