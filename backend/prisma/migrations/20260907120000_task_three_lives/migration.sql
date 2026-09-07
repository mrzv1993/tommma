-- AlterTable
ALTER TABLE "public"."tasks" ADD COLUMN     "done_when" VARCHAR(500) NOT NULL DEFAULT '',
ADD COLUMN     "focus_heartbeat_at" TIMESTAMP(3),
ADD COLUMN     "focus_spent_ms" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "is_container" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parent_task_id" VARCHAR(64),
ADD COLUMN     "work_summary" VARCHAR(4000) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "public"."task_work_sessions" (
    "id" UUID NOT NULL,
    "user_id" BIGINT NOT NULL,
    "task_id" VARCHAR(64) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkpoint_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "credited_ms" INTEGER NOT NULL DEFAULT 0,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "task_work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_work_sessions_user_id_ended_at_idx" ON "public"."task_work_sessions"("user_id", "ended_at");

-- CreateIndex
CREATE INDEX "task_work_sessions_task_id_idx" ON "public"."task_work_sessions"("task_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_parent_task_id_idx" ON "public"."tasks"("user_id", "parent_task_id");

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_work_sessions" ADD CONSTRAINT "task_work_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."task_work_sessions" ADD CONSTRAINT "task_work_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One live lease per user, even if another writer bypasses the application lock.
CREATE UNIQUE INDEX "task_work_sessions_one_active_per_user"
ON "task_work_sessions" ("user_id") WHERE "ended_at" IS NULL;
ALTER TABLE "tasks" ADD CONSTRAINT "task_focus_budget" CHECK ("focus_spent_ms" BETWEEN 0 AND 5400000);
ALTER TABLE "tasks" ADD CONSTRAINT "task_not_own_parent" CHECK ("parent_task_id" IS DISTINCT FROM "id");
