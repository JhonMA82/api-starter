CREATE TABLE "incoming_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incoming_webhooks_provider_event_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
CREATE INDEX "incoming_webhooks_provider_idx" ON "incoming_webhooks" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "incoming_webhooks_status_idx" ON "incoming_webhooks" USING btree ("status");