CREATE TYPE "research_job_status" AS ENUM (
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled'
);

CREATE TYPE "research_trigger_type" AS ENUM (
  'manual',
  'internal_api',
  'n8n'
);

CREATE TYPE "research_mode" AS ENUM (
  'deterministic',
  'openai'
);

CREATE TYPE "research_source_status" AS ENUM (
  'selected',
  'processing',
  'succeeded',
  'skipped',
  'failed'
);

CREATE TYPE "research_note_type" AS ENUM ('source_summary');
CREATE TYPE "ai_usage_status" AS ENUM ('started', 'succeeded', 'failed');

ALTER TABLE "audit_logs" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "audit_logs_dedupe_key_key" ON "audit_logs"("dedupe_key");

CREATE TABLE "research_jobs" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "topic_id" TEXT NOT NULL,
  "active_topic_id" TEXT,
  "status" "research_job_status" NOT NULL DEFAULT 'queued',
  "trigger_type" "research_trigger_type" NOT NULL,
  "mode" "research_mode" NOT NULL,
  "deterministic_fallback_used" BOOLEAN NOT NULL DEFAULT false,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "selected_evidence_count" INTEGER NOT NULL DEFAULT 0,
  "fetched_source_count" INTEGER NOT NULL DEFAULT 0,
  "successful_source_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_source_count" INTEGER NOT NULL DEFAULT 0,
  "failed_source_count" INTEGER NOT NULL DEFAULT 0,
  "generated_note_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_summary" TEXT,
  "workflow_execution_reference" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_jobs_active_topic_check"
    CHECK ("active_topic_id" IS NULL OR "active_topic_id" = "topic_id"),
  CONSTRAINT "research_jobs_counts_check"
    CHECK (
      "selected_evidence_count" >= 0 AND
      "fetched_source_count" >= 0 AND
      "successful_source_count" >= 0 AND
      "skipped_source_count" >= 0 AND
      "failed_source_count" >= 0 AND
      "generated_note_count" >= 0
    )
);

CREATE UNIQUE INDEX "research_jobs_active_topic_id_key"
  ON "research_jobs"("active_topic_id");
CREATE INDEX "research_jobs_site_id_status_created_at_idx"
  ON "research_jobs"("site_id", "status", "created_at");
CREATE INDEX "research_jobs_topic_id_created_at_idx"
  ON "research_jobs"("topic_id", "created_at");

CREATE TABLE "research_job_sources" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "evidence_id" TEXT,
  "source_config_id" TEXT,
  "source_url" TEXT NOT NULL,
  "canonical_url" TEXT NOT NULL,
  "source_title" TEXT,
  "selection_rank" INTEGER NOT NULL,
  "status" "research_source_status" NOT NULL DEFAULT 'selected',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "fetched_at" TIMESTAMP(3),
  "content_type" TEXT,
  "content_fingerprint" TEXT,
  "error_code" TEXT,
  "error_summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "research_job_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_job_sources_limits_check"
    CHECK ("selection_rank" >= 0 AND "attempt_count" >= 0)
);

CREATE UNIQUE INDEX "research_job_sources_research_job_id_canonical_url_key"
  ON "research_job_sources"("research_job_id", "canonical_url");
CREATE INDEX "research_job_sources_research_job_id_status_selection_rank_idx"
  ON "research_job_sources"("research_job_id", "status", "selection_rank");
CREATE INDEX "research_job_sources_evidence_id_idx"
  ON "research_job_sources"("evidence_id");

CREATE TABLE "research_notes" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "research_job_source_id" TEXT NOT NULL,
  "topic_id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "evidence_id" TEXT,
  "note_type" "research_note_type" NOT NULL DEFAULT 'source_summary',
  "mode" "research_mode" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "claims" JSONB NOT NULL,
  "definitions" JSONB NOT NULL,
  "statistics" JSONB NOT NULL,
  "examples" JSONB NOT NULL,
  "risks" JSONB NOT NULL,
  "open_questions" JSONB NOT NULL,
  "excerpts" JSONB NOT NULL,
  "source_url" TEXT NOT NULL,
  "source_title" TEXT NOT NULL,
  "source_publisher" TEXT,
  "author" TEXT,
  "published_at" TIMESTAMP(3),
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "content_fingerprint" TEXT NOT NULL,
  "quality_flags" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "research_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_notes_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "research_notes_research_job_source_id_content_fingerprint_key"
  ON "research_notes"("research_job_source_id", "content_fingerprint");
CREATE INDEX "research_notes_topic_id_created_at_idx"
  ON "research_notes"("topic_id", "created_at");
CREATE INDEX "research_notes_research_job_id_created_at_idx"
  ON "research_notes"("research_job_id", "created_at");

CREATE TABLE "ai_usage" (
  "id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "research_job_source_id" TEXT NOT NULL,
  "research_note_id" TEXT,
  "request_key" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "estimated_cost_usd" DECIMAL(12,6),
  "request_duration_ms" INTEGER NOT NULL,
  "status" "ai_usage_status" NOT NULL,
  "error_code" TEXT,
  "prompt_template_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_usage_limits_check"
    CHECK (
      ("input_tokens" IS NULL OR "input_tokens" >= 0) AND
      ("output_tokens" IS NULL OR "output_tokens" >= 0) AND
      "request_duration_ms" >= 0
    )
);

CREATE UNIQUE INDEX "ai_usage_request_key_key" ON "ai_usage"("request_key");
CREATE INDEX "ai_usage_research_job_id_created_at_idx"
  ON "ai_usage"("research_job_id", "created_at");

ALTER TABLE "research_jobs"
  ADD CONSTRAINT "research_jobs_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_jobs_topic_id_fkey"
  FOREIGN KEY ("topic_id") REFERENCES "topics"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "research_job_sources"
  ADD CONSTRAINT "research_job_sources_research_job_id_fkey"
  FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_job_sources_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "topic_evidence"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "research_job_sources_source_config_id_fkey"
  FOREIGN KEY ("source_config_id") REFERENCES "source_configs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "research_notes"
  ADD CONSTRAINT "research_notes_research_job_id_fkey"
  FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_notes_research_job_source_id_fkey"
  FOREIGN KEY ("research_job_source_id") REFERENCES "research_job_sources"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_notes_topic_id_fkey"
  FOREIGN KEY ("topic_id") REFERENCES "topics"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_notes_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_notes_evidence_id_fkey"
  FOREIGN KEY ("evidence_id") REFERENCES "topic_evidence"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_usage"
  ADD CONSTRAINT "ai_usage_research_job_id_fkey"
  FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_usage_research_job_source_id_fkey"
  FOREIGN KEY ("research_job_source_id") REFERENCES "research_job_sources"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_usage_research_note_id_fkey"
  FOREIGN KEY ("research_note_id") REFERENCES "research_notes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
