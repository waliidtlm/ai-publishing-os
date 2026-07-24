CREATE TYPE "rss_collection_status" AS ENUM (
  'started',
  'succeeded',
  'partial',
  'failed',
  'not_modified'
);

ALTER TABLE "source_configs"
  ADD COLUMN "collection_limit" INTEGER,
  ADD COLUMN "last_successful_collected_at" TIMESTAMP(3),
  ADD COLUMN "last_error_at" TIMESTAMP(3),
  ADD COLUMN "last_error_summary" TEXT,
  ADD COLUMN "http_etag" TEXT,
  ADD COLUMN "http_last_modified" TEXT;

ALTER TABLE "source_configs"
  ADD CONSTRAINT "source_configs_collection_limit_check"
  CHECK ("collection_limit" IS NULL OR ("collection_limit" >= 1 AND "collection_limit" <= 100));

CREATE TABLE "rss_collection_runs" (
  "id" TEXT NOT NULL,
  "source_config_id" TEXT NOT NULL,
  "workflow_execution_id" TEXT,
  "status" "rss_collection_status" NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "discovered_count" INTEGER NOT NULL DEFAULT 0,
  "returned_count" INTEGER NOT NULL DEFAULT 0,
  "submitted_count" INTEGER NOT NULL DEFAULT 0,
  "accepted_count" INTEGER NOT NULL DEFAULT 0,
  "matched_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "http_status" INTEGER,
  "etag" TEXT,
  "last_modified" TEXT,
  "error_code" TEXT,
  "error_summary" TEXT,
  "duration_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rss_collection_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "rss_collection_runs"
  ADD CONSTRAINT "rss_collection_runs_source_config_id_fkey"
  FOREIGN KEY ("source_config_id") REFERENCES "source_configs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rss_collection_runs"
  ADD CONSTRAINT "rss_collection_runs_nonnegative_counts_check"
  CHECK (
    "discovered_count" >= 0 AND
    "returned_count" >= 0 AND
    "submitted_count" >= 0 AND
    "accepted_count" >= 0 AND
    "matched_count" >= 0 AND
    "skipped_count" >= 0 AND
    "failed_count" >= 0 AND
    ("duration_ms" IS NULL OR "duration_ms" >= 0)
  );

CREATE INDEX "rss_collection_runs_source_config_id_started_at_idx"
  ON "rss_collection_runs"("source_config_id", "started_at");

CREATE INDEX "rss_collection_runs_status_started_at_idx"
  ON "rss_collection_runs"("status", "started_at");
