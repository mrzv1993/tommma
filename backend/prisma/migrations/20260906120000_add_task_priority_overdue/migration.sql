ALTER TABLE "tasks"
  ADD COLUMN "priority_overdue" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_priority_overdue_check"
  CHECK ("priority_overdue" BETWEEN 0 AND 9);
