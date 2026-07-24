CREATE TYPE "ai_operation_type" AS ENUM (
  'research_source_notes',
  'content_brief'
);

CREATE TYPE "brief_generation_job_status" AS ENUM (
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE "content_brief_status" AS ENUM ('current', 'superseded');

CREATE TYPE "reader_intent_type" AS ENUM (
  'informational',
  'how_to',
  'comparison',
  'decision_support',
  'troubleshooting',
  'transactional',
  'navigational',
  'thought_leadership'
);

CREATE TYPE "article_type" AS ENUM (
  'guide',
  'explainer',
  'tutorial',
  'comparison',
  'checklist',
  'case_study',
  'opinion',
  'reference',
  'troubleshooting',
  'news_analysis'
);

CREATE TABLE "brief_generation_jobs" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "topic_id" TEXT NOT NULL,
  "active_topic_id" TEXT,
  "research_job_id" TEXT NOT NULL,
  "status" "brief_generation_job_status" NOT NULL DEFAULT 'queued',
  "mode" "research_mode" NOT NULL,
  "prompt_template_version" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "research_snapshot_fingerprint" TEXT NOT NULL,
  "research_snapshot" JSONB NOT NULL,
  "adjustment_request" JSONB,
  "regeneration_reason" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "input_note_count" INTEGER NOT NULL DEFAULT 0,
  "input_claim_count" INTEGER NOT NULL DEFAULT 0,
  "included_source_count" INTEGER NOT NULL DEFAULT 0,
  "generated_section_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_summary" TEXT,
  "workflow_execution_reference" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "brief_generation_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "brief_generation_jobs_active_topic_check"
    CHECK ("active_topic_id" IS NULL OR "active_topic_id" = "topic_id"),
  CONSTRAINT "brief_generation_jobs_counts_check"
    CHECK (
      "input_note_count" >= 0 AND
      "input_claim_count" >= 0 AND
      "included_source_count" >= 0 AND
      "generated_section_count" >= 0
    )
);

CREATE UNIQUE INDEX "brief_generation_jobs_active_topic_id_key"
  ON "brief_generation_jobs"("active_topic_id");
CREATE INDEX "brief_generation_jobs_site_id_status_created_at_idx"
  ON "brief_generation_jobs"("site_id", "status", "created_at");
CREATE INDEX "brief_generation_jobs_topic_id_created_at_idx"
  ON "brief_generation_jobs"("topic_id", "created_at");
CREATE INDEX "brief_generation_jobs_topic_id_input_fingerprint_idx"
  ON "brief_generation_jobs"("topic_id", "input_fingerprint");

CREATE TABLE "content_briefs" (
  "id" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "topic_id" TEXT NOT NULL,
  "current_topic_id" TEXT,
  "brief_generation_job_id" TEXT NOT NULL,
  "research_job_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "content_brief_status" NOT NULL DEFAULT 'current',
  "primary_title" TEXT NOT NULL,
  "alternative_titles" JSONB NOT NULL,
  "target_audience" JSONB NOT NULL,
  "intent_type" "reader_intent_type" NOT NULL,
  "intent" JSONB NOT NULL,
  "angle" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "scope" JSONB NOT NULL,
  "exclusions" JSONB NOT NULL,
  "article_type" "article_type" NOT NULL,
  "target_depth" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "outline" JSONB NOT NULL,
  "key_claims" JSONB NOT NULL,
  "required_sources" JSONB NOT NULL,
  "questions_to_answer" JSONB NOT NULL,
  "definitions" JSONB NOT NULL,
  "examples" JSONB NOT NULL,
  "statistics" JSONB NOT NULL,
  "risks_and_caveats" JSONB NOT NULL,
  "research_gaps" JSONB NOT NULL,
  "internal_link_suggestions" JSONB NOT NULL,
  "external_reference_requirements" JSONB NOT NULL,
  "drafting_instructions" JSONB NOT NULL,
  "quality_requirements" JSONB NOT NULL,
  "estimated_word_count_minimum" INTEGER NOT NULL,
  "estimated_word_count_maximum" INTEGER NOT NULL,
  "research_snapshot" JSONB NOT NULL,
  "research_snapshot_fingerprint" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "content_briefs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_briefs_current_topic_check"
    CHECK (
      ("current_topic_id" IS NULL AND "status" = 'superseded') OR
      ("current_topic_id" = "topic_id" AND "status" = 'current')
    ),
  CONSTRAINT "content_briefs_version_check" CHECK ("version" >= 1),
  CONSTRAINT "content_briefs_word_count_check"
    CHECK (
      "estimated_word_count_minimum" >= 300 AND
      "estimated_word_count_maximum" >= "estimated_word_count_minimum" AND
      "estimated_word_count_maximum" <= 20000
    )
);

CREATE UNIQUE INDEX "content_briefs_current_topic_id_key"
  ON "content_briefs"("current_topic_id");
CREATE UNIQUE INDEX "content_briefs_brief_generation_job_id_key"
  ON "content_briefs"("brief_generation_job_id");
CREATE UNIQUE INDEX "content_briefs_topic_id_version_key"
  ON "content_briefs"("topic_id", "version");
CREATE UNIQUE INDEX "content_briefs_topic_id_input_fingerprint_key"
  ON "content_briefs"("topic_id", "input_fingerprint");
CREATE INDEX "content_briefs_site_id_status_created_at_idx"
  ON "content_briefs"("site_id", "status", "created_at");
CREATE INDEX "content_briefs_topic_id_created_at_idx"
  ON "content_briefs"("topic_id", "created_at");

ALTER TABLE "ai_usage"
  ALTER COLUMN "research_job_id" DROP NOT NULL,
  ALTER COLUMN "research_job_source_id" DROP NOT NULL,
  ADD COLUMN "brief_generation_job_id" TEXT,
  ADD COLUMN "content_brief_id" TEXT,
  ADD COLUMN "operation_type" "ai_operation_type" NOT NULL
    DEFAULT 'research_source_notes';

CREATE INDEX "ai_usage_brief_generation_job_id_created_at_idx"
  ON "ai_usage"("brief_generation_job_id", "created_at");

ALTER TABLE "brief_generation_jobs"
  ADD CONSTRAINT "brief_generation_jobs_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "brief_generation_jobs_topic_id_fkey"
  FOREIGN KEY ("topic_id") REFERENCES "topics"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "brief_generation_jobs_research_job_id_fkey"
  FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "content_briefs"
  ADD CONSTRAINT "content_briefs_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "content_briefs_topic_id_fkey"
  FOREIGN KEY ("topic_id") REFERENCES "topics"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "content_briefs_brief_generation_job_id_fkey"
  FOREIGN KEY ("brief_generation_job_id") REFERENCES "brief_generation_jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "content_briefs_research_job_id_fkey"
  FOREIGN KEY ("research_job_id") REFERENCES "research_jobs"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_usage"
  ADD CONSTRAINT "ai_usage_brief_generation_job_id_fkey"
  FOREIGN KEY ("brief_generation_job_id") REFERENCES "brief_generation_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_usage_content_brief_id_fkey"
  FOREIGN KEY ("content_brief_id") REFERENCES "content_briefs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_usage"
  ADD CONSTRAINT "ai_usage_operation_owner_check"
  CHECK (
    (
      "operation_type" = 'research_source_notes' AND
      "research_job_id" IS NOT NULL AND
      "research_job_source_id" IS NOT NULL AND
      "brief_generation_job_id" IS NULL
    ) OR (
      "operation_type" = 'content_brief' AND
      "brief_generation_job_id" IS NOT NULL AND
      "research_job_source_id" IS NULL AND
      "research_note_id" IS NULL
    )
  );
