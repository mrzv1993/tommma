WITH ranked_tasks AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id"
      ORDER BY "priority_rank", "created_at_ms", "id"
    ) AS global_rank
  FROM "tasks"
  WHERE "completed" = FALSE AND "priority_group" IS NOT NULL
), normalized_groups AS (
  SELECT
    "id",
    CASE
      WHEN global_rank <= 1 THEN 1
      WHEN global_rank <= 3 THEN 2
      WHEN global_rank <= 6 THEN 3
      WHEN global_rank <= 10 THEN 4
      WHEN global_rank <= 15 THEN 5
      WHEN global_rank <= 21 THEN 6
      WHEN global_rank <= 28 THEN 7
      WHEN global_rank <= 36 THEN 8
      WHEN global_rank <= 45 THEN 9
      ELSE NULL
    END AS priority_group
  FROM ranked_tasks
)
UPDATE "tasks" AS task
SET "priority_group" = normalized_groups.priority_group
FROM normalized_groups
WHERE task."id" = normalized_groups."id";
