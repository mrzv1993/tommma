ALTER TABLE "tasks" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "tasks_user_id_deleted_at_idx" ON "tasks"("user_id", "deleted_at");
