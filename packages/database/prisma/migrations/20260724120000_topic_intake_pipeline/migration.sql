-- AlterTable
ALTER TABLE "topics"
ADD COLUMN "intake_origin" TEXT,
ADD COLUMN "intake_metadata" JSONB;

-- AlterTable
ALTER TABLE "topic_evidence"
ADD COLUMN "external_id" TEXT,
ADD COLUMN "evidence_fingerprint" TEXT;

-- CreateTable
CREATE TABLE "intake_idempotency_records" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "topic_id" TEXT,
    "evidence_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_api_rate_limit_buckets" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "identifier_hash" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_api_rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "topic_evidence_topic_id_evidence_fingerprint_key"
ON "topic_evidence"("topic_id", "evidence_fingerprint");

-- CreateIndex
CREATE INDEX "topic_evidence_source_config_id_external_id_idx"
ON "topic_evidence"("source_config_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_idempotency_records_scope_key_key"
ON "intake_idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "intake_idempotency_records_created_at_idx"
ON "intake_idempotency_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "internal_api_rate_limit_buckets_scope_identifier_hash_window_start_key"
ON "internal_api_rate_limit_buckets"("scope", "identifier_hash", "window_start");

-- CreateIndex
CREATE INDEX "internal_api_rate_limit_buckets_window_start_idx"
ON "internal_api_rate_limit_buckets"("window_start");
