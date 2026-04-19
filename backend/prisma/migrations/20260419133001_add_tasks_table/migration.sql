-- CreateTable
CREATE TABLE "public"."tasks" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "column_id" VARCHAR(32) NOT NULL,
    "date_key" VARCHAR(10) NOT NULL,
    "recurrence_parent_id" VARCHAR(64),
    "recurrence" VARCHAR(16) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at_ms" BIGINT NOT NULL,
    "actual_seconds" INTEGER NOT NULL DEFAULT 0,
    "session_seconds" INTEGER NOT NULL DEFAULT 0,
    "session_started_at_ms" BIGINT,
    "subtasks" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_user_id_date_key_idx" ON "public"."tasks"("user_id", "date_key");

-- CreateIndex
CREATE INDEX "tasks_user_id_recurrence_parent_id_idx" ON "public"."tasks"("user_id", "recurrence_parent_id");

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
