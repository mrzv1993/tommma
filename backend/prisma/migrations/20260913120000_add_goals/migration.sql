-- CreateTable
CREATE TABLE "public"."goals" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at_ms" BIGINT NOT NULL,
    "priority_group" INTEGER,
    "priority_rank" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority_importance" INTEGER NOT NULL DEFAULT 0,
    "priority_urgency" INTEGER NOT NULL DEFAULT 0,
    "priority_overdue" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_user_id_completed_priority_group_priority_rank_idx" ON "public"."goals"("user_id", "completed", "priority_group", "priority_rank");

-- CreateIndex
CREATE INDEX "goals_user_id_deleted_at_idx" ON "public"."goals"("user_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "public"."goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
