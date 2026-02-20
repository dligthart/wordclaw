CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_hash" text NOT NULL,
	"payment_request" text NOT NULL,
	"amount_satoshis" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resource_path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payments_payment_hash_unique" UNIQUE("payment_hash")
);
