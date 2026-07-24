-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "site_status" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "source_type" AS ENUM ('website', 'rss', 'news_api', 'search_console', 'manual');

-- CreateEnum
CREATE TYPE "collection_method" AS ENUM ('api', 'rss', 'crawl', 'manual');

-- CreateEnum
CREATE TYPE "trust_level" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "collection_frequency" AS ENUM ('manual', 'hourly', 'daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "topic_status" AS ENUM ('candidate', 'reviewing', 'approved', 'researching', 'brief_ready', 'drafting', 'quality_review', 'awaiting_approval', 'approved_for_publishing', 'published', 'rejected', 'failed');

-- CreateEnum
CREATE TYPE "topic_priority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "evidence_type" AS ENUM ('manual', 'source', 'trend', 'keyword', 'competitor', 'performance');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "niche" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "target_audience" TEXT,
    "status" "site_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_configs" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" "source_type" NOT NULL,
    "base_url" TEXT,
    "collection_method" "collection_method" NOT NULL,
    "trust_level" "trust_level" NOT NULL DEFAULT 'medium',
    "collection_frequency" "collection_frequency" NOT NULL DEFAULT 'manual',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_collected_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalized_title" TEXT NOT NULL,
    "description" TEXT,
    "status" "topic_status" NOT NULL DEFAULT 'candidate',
    "priority" "topic_priority" NOT NULL DEFAULT 'medium',
    "total_score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_evidence" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "source_config_id" TEXT,
    "evidence_type" "evidence_type" NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_title" TEXT,
    "excerpt" TEXT,
    "collected_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topic_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_scores" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "audience_relevance" INTEGER NOT NULL,
    "evidence_strength" INTEGER NOT NULL,
    "business_value" INTEGER NOT NULL,
    "content_gap" INTEGER NOT NULL,
    "freshness" INTEGER NOT NULL,
    "source_reliability" INTEGER NOT NULL,
    "production_feasibility" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previous_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sites_domain_key" ON "sites"("domain");

-- CreateIndex
CREATE INDEX "sites_status_idx" ON "sites"("status");

-- CreateIndex
CREATE INDEX "source_configs_site_id_is_active_idx" ON "source_configs"("site_id", "is_active");

-- CreateIndex
CREATE INDEX "source_configs_is_active_last_collected_at_idx" ON "source_configs"("is_active", "last_collected_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_configs_site_id_name_key" ON "source_configs"("site_id", "name");

-- CreateIndex
CREATE INDEX "topics_site_id_status_priority_idx" ON "topics"("site_id", "status", "priority");

-- CreateIndex
CREATE INDEX "topics_site_id_total_score_idx" ON "topics"("site_id", "total_score");

-- CreateIndex
CREATE UNIQUE INDEX "topics_site_id_normalized_title_key" ON "topics"("site_id", "normalized_title");

-- CreateIndex
CREATE INDEX "topic_evidence_topic_id_collected_at_idx" ON "topic_evidence"("topic_id", "collected_at");

-- CreateIndex
CREATE INDEX "topic_evidence_source_config_id_idx" ON "topic_evidence"("source_config_id");

-- CreateIndex
CREATE UNIQUE INDEX "topic_evidence_topic_id_source_url_evidence_type_key" ON "topic_evidence"("topic_id", "source_url", "evidence_type");

-- CreateIndex
CREATE INDEX "topic_scores_topic_id_created_at_idx" ON "topic_scores"("topic_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "source_configs" ADD CONSTRAINT "source_configs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_evidence" ADD CONSTRAINT "topic_evidence_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_evidence" ADD CONSTRAINT "topic_evidence_source_config_id_fkey" FOREIGN KEY ("source_config_id") REFERENCES "source_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_scores" ADD CONSTRAINT "topic_scores_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
