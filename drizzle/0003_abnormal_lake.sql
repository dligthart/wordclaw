ALTER TABLE "content_item_versions" DROP CONSTRAINT "content_item_versions_content_item_id_content_items_id_fk";
--> statement-breakpoint
ALTER TABLE "content_item_versions" ADD CONSTRAINT "content_item_versions_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;