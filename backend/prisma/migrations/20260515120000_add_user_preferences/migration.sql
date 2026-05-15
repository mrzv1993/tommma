CREATE TABLE "user_preferences" (
  "user_id" BIGINT NOT NULL,
  "nav_order" JSONB NOT NULL DEFAULT '[]',
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
