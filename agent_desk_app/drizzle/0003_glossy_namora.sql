CREATE INDEX "articles_site_id_idx" ON "articles" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "articles_site_id_created_at_idx" ON "articles" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_site_id_created_at_idx" ON "conversations" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_site_id_visitor_id_idx" ON "conversations" USING btree ("site_id","visitor_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "sites_user_id_idx" ON "sites" USING btree ("user_id");