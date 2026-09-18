-- CreateTable
CREATE TABLE "public"."capital_assets" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,

    CONSTRAINT "capital_assets_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_locations" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "capital_locations_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_networks" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "capital_networks_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_operations" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "external_revision" TEXT,
    "import_key" TEXT,
    "chain_key" TEXT,
    "location_from_id" TEXT,
    "location_to_id" TEXT,
    "network_id" TEXT,
    "tx_hash" TEXT,
    "log_index" INTEGER,
    "destination_address" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "capital_operations_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_legs" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "location_id" TEXT,
    "amount" DECIMAL(38,18) NOT NULL,
    "fiat_value" DECIMAL(38,8),
    "unit_price" DECIMAL(38,18),
    "position" INTEGER NOT NULL,

    CONSTRAINT "capital_legs_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_audit_events" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "operation_id" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_audit_events_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_sync_sources" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cursor" TEXT,
    "last_success_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_sync_sources_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_sync_runs" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cursor" TEXT,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeat_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "capital_sync_runs_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_external_records" (
    "user_id" BIGINT NOT NULL,
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "revision" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_external_records_pkey" PRIMARY KEY ("user_id","id")
);

-- CreateTable
CREATE TABLE "public"."capital_settings" (
    "user_id" BIGINT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capital_settings_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateIndex
CREATE INDEX "capital_operations_user_id_occurred_at_created_at_idx" ON "public"."capital_operations"("user_id", "occurred_at", "created_at");

-- CreateIndex
CREATE INDEX "capital_operations_user_id_status_idx" ON "public"."capital_operations"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capital_operations_user_id_import_key_key" ON "public"."capital_operations"("user_id", "import_key");

-- CreateIndex
CREATE UNIQUE INDEX "capital_operations_user_id_chain_key_key" ON "public"."capital_operations"("user_id", "chain_key");

-- CreateIndex
CREATE INDEX "capital_legs_user_id_asset_id_idx" ON "public"."capital_legs"("user_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "capital_legs_user_id_operation_id_position_key" ON "public"."capital_legs"("user_id", "operation_id", "position");

-- CreateIndex
CREATE INDEX "capital_audit_events_user_id_operation_id_created_at_idx" ON "public"."capital_audit_events"("user_id", "operation_id", "created_at");

-- CreateIndex
CREATE INDEX "capital_sync_runs_user_id_source_started_at_idx" ON "public"."capital_sync_runs"("user_id", "source", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "capital_external_records_user_id_source_external_id_key" ON "public"."capital_external_records"("user_id", "source", "external_id");

-- AddForeignKey
ALTER TABLE "public"."capital_assets" ADD CONSTRAINT "capital_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_locations" ADD CONSTRAINT "capital_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_networks" ADD CONSTRAINT "capital_networks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_operations" ADD CONSTRAINT "capital_operations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_operations" ADD CONSTRAINT "capital_operations_user_id_location_from_id_fkey" FOREIGN KEY ("user_id", "location_from_id") REFERENCES "public"."capital_locations"("user_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."capital_operations" ADD CONSTRAINT "capital_operations_user_id_location_to_id_fkey" FOREIGN KEY ("user_id", "location_to_id") REFERENCES "public"."capital_locations"("user_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."capital_operations" ADD CONSTRAINT "capital_operations_user_id_network_id_fkey" FOREIGN KEY ("user_id", "network_id") REFERENCES "public"."capital_networks"("user_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."capital_legs" ADD CONSTRAINT "capital_legs_user_id_operation_id_fkey" FOREIGN KEY ("user_id", "operation_id") REFERENCES "public"."capital_operations"("user_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_legs" ADD CONSTRAINT "capital_legs_user_id_asset_id_fkey" FOREIGN KEY ("user_id", "asset_id") REFERENCES "public"."capital_assets"("user_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."capital_legs" ADD CONSTRAINT "capital_legs_user_id_location_id_fkey" FOREIGN KEY ("user_id", "location_id") REFERENCES "public"."capital_locations"("user_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."capital_audit_events" ADD CONSTRAINT "capital_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_audit_events" ADD CONSTRAINT "capital_audit_events_user_id_operation_id_fkey" FOREIGN KEY ("user_id", "operation_id") REFERENCES "public"."capital_operations"("user_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."capital_sync_sources" ADD CONSTRAINT "capital_sync_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_sync_runs" ADD CONSTRAINT "capital_sync_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_external_records" ADD CONSTRAINT "capital_external_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."capital_settings" ADD CONSTRAINT "capital_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Financial invariants also hold for maintenance/import writers.
ALTER TABLE "capital_operations" ADD CONSTRAINT "capital_operation_type_check" CHECK ("type" IN ('purchase','conversion','transfer'));
ALTER TABLE "capital_operations" ADD CONSTRAINT "capital_operation_status_check" CHECK ("status" IN ('draft','pending','completed','failed','needs_review','archived'));
ALTER TABLE "capital_operations" ADD CONSTRAINT "capital_operation_source_check" CHECK ("source" IN ('manual','okx_exchange','okx_wallet','csv'));
ALTER TABLE "capital_operations" ADD CONSTRAINT "capital_operation_archive_check" CHECK (("status" = 'archived') = ("archived_at" IS NOT NULL));
ALTER TABLE "capital_legs" ADD CONSTRAINT "capital_leg_amount_check" CHECK ("amount" > 0 AND ("fiat_value" IS NULL OR "fiat_value" >= 0) AND ("unit_price" IS NULL OR "unit_price" >= 0));
ALTER TABLE "capital_legs" ADD CONSTRAINT "capital_leg_direction_check" CHECK ("direction" IN ('in','out','fee'));
ALTER TABLE "capital_assets" ADD CONSTRAINT "capital_asset_precision_check" CHECK ("decimals" BETWEEN 0 AND 18);
CREATE UNIQUE INDEX "capital_sync_single_running" ON "capital_sync_runs" ("user_id", "source") WHERE "status" = 'running';
