CREATE TABLE "dns_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"credentials" text NOT NULL,
	"last_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "dns_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "dns_zone_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "dns_zone_name" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "crawl_host" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "crawl_origin_ip" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "crawl_record_id" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "crawl_host_created_at" timestamp;--> statement-breakpoint
ALTER TABLE "dns_connections" ADD CONSTRAINT "dns_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dns_connections_user_id_idx" ON "dns_connections" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_dns_connection_id_dns_connections_id_fk" FOREIGN KEY ("dns_connection_id") REFERENCES "public"."dns_connections"("id") ON DELETE set null ON UPDATE no action;