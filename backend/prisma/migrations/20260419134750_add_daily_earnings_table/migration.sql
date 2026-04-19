-- CreateTable
CREATE TABLE "public"."daily_earnings" (
    "id" VARCHAR(64) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "date_key" VARCHAR(10) NOT NULL,
    "project_name" VARCHAR(120) NOT NULL,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_earnings_user_id_date_key_idx" ON "public"."daily_earnings"("user_id", "date_key");

-- AddForeignKey
ALTER TABLE "public"."daily_earnings" ADD CONSTRAINT "daily_earnings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
