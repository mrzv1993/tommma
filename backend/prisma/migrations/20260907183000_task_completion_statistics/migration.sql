-- AlterTable
ALTER TABLE "public"."tasks" ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "completion_focus_ms" INTEGER;

-- CreateIndex
CREATE INDEX "tasks_user_id_completed_at_idx" ON "public"."tasks"("user_id", "completed_at");

