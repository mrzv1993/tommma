ALTER TABLE "tasks"
  ADD COLUMN "priority_group" INTEGER,
  ADD COLUMN "priority_rank" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "tasks"
SET "priority_rank" = "created_at_ms"::DOUBLE PRECISION;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_priority_group_check"
  CHECK ("priority_group" IS NULL OR "priority_group" BETWEEN 1 AND 9);

CREATE INDEX "tasks_user_id_completed_priority_group_priority_rank_idx"
  ON "tasks"("user_id", "completed", "priority_group", "priority_rank");
