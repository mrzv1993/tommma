-- CreateTable
CREATE TABLE "public"."process_items" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "process_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "process_items_user_id_deleted_at_rank_idx" ON "public"."process_items"("user_id", "deleted_at", "rank");

-- AddForeignKey
ALTER TABLE "public"."process_items" ADD CONSTRAINT "process_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
