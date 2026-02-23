CREATE TABLE "content_item_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"domain_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"text_chunk" text NOT NULL,
	"embedding" vector(1536) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_item_embeddings" ADD CONSTRAINT "content_item_embeddings_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_embeddings" ADD CONSTRAINT "content_item_embeddings_domain_id_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embedding_idx" ON "content_item_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "embedding_domain_idx" ON "content_item_embeddings" USING btree ("domain_id");