ALTER TABLE "tasks"
  ADD COLUMN "priority_importance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "priority_urgency" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_priority_importance_check"
  CHECK ("priority_importance" BETWEEN 0 AND 9),
  ADD CONSTRAINT "tasks_priority_urgency_check"
  CHECK ("priority_urgency" BETWEEN 0 AND 9);

WITH ranked_tasks AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "priority_group", "priority_rank", "created_at_ms", "id"
    ) AS global_rank
  FROM "tasks"
  WHERE "completed" = FALSE AND "priority_group" IS NOT NULL
)
UPDATE "tasks" AS task
SET "priority_rank" = ranked_tasks.global_rank * 1024
FROM ranked_tasks
WHERE task."id" = ranked_tasks."id";
