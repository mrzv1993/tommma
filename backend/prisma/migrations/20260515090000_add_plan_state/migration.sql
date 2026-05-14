CREATE TABLE "plan_states" (
  "user_id" BIGINT NOT NULL,
  "elements" JSONB NOT NULL DEFAULT '[]',
  "deleted_element_ids" JSONB NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "plan_states_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "plan_states"
ADD CONSTRAINT "plan_states_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
