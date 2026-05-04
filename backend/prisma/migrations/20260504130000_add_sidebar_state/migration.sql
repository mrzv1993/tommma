CREATE TABLE "sidebar_states" (
  "user_id" BIGINT NOT NULL,
  "stories" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "boards" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "sidebar_width" INTEGER NOT NULL DEFAULT 240,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sidebar_states_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "sidebar_states"
  ADD CONSTRAINT "sidebar_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
