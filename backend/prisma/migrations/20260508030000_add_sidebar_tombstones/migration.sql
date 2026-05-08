ALTER TABLE "sidebar_states"
  ADD COLUMN "deleted_story_keys" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "deleted_section_ids" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "deleted_card_ids" JSONB NOT NULL DEFAULT '{}'::jsonb;
