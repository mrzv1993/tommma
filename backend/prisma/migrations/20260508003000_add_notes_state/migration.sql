CREATE TABLE "notes_states" (
  "user_id" BIGINT NOT NULL,
  "notes" JSONB NOT NULL DEFAULT '[]',
  "sidebar_width" INTEGER NOT NULL DEFAULT 240,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notes_states_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "notes_states"
  ADD CONSTRAINT "notes_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
