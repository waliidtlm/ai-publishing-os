import { randomUUID } from "node:crypto";

import {
  BriefGenerationJobStatus,
  ContentBriefStatus,
  ResearchJobStatus,
  ResearchMode,
  ResearchSourceStatus,
  ResearchTriggerType,
  TopicStatus,
  getDatabaseClient,
  type PrismaClient,
} from "@ai-publishing-os/database";
import type { ContentBriefEnvironment } from "@ai-publishing-os/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContentBriefError } from "../../apps/dashboard/lib/content-brief/errors";
import { DeterministicBriefProvider } from "../../apps/dashboard/lib/content-brief/providers/deterministic";
import type {
  BriefProvider,
  BriefProviderInput,
} from "../../apps/dashboard/lib/content-brief/types";
import {
  createBriefGenerationJob,
  generateContentBrief,
} from "../../apps/dashboard/lib/content-brief/service";

const runToken = `brief-${randomUUID()}`;
let database: PrismaClient;

const environment: ContentBriefEnvironment = {
  AI_MODEL_CONTENT_BRIEF: "test-model",
  CONTENT_BRIEF_AI_ENABLED: false,
  CONTENT_BRIEF_ALLOW_DETERMINISTIC_FALLBACK: false,
  CONTENT_BRIEF_DEFAULT_MODE: "deterministic",
  CONTENT_BRIEF_MAX_CLAIMS: 50,
  CONTENT_BRIEF_MAX_CONCURRENT_AI_PER_SITE: 1,
  CONTENT_BRIEF_MAX_GENERATIONS_PER_HOUR: 100,
  CONTENT_BRIEF_MAX_GENERATIONS_PER_TOPIC_PER_HOUR: 25,
  CONTENT_BRIEF_MAX_NOTES: 20,
  CONTENT_BRIEF_MAX_OUTLINE_SECTIONS: 12,
  CONTENT_BRIEF_MAX_OUTPUT_TOKENS: 4_000,
  CONTENT_BRIEF_MAX_PROMPT_CHARS: 120_000,
  CONTENT_BRIEF_MAX_SOURCES: 20,
};

async function fixture(options: {
  status?: TopicStatus;
  usableNote?: boolean;
}) {
  const suffix = randomUUID();
  const site = await database.site.create({
    data: {
      domain: `${runToken}-${suffix}.example.test`,
      name: "Brief integration site",
      targetAudience: "Automation engineers",
    },
  });
  const topic = await database.topic.create({
    data: {
      description: "A technical guide grounded in completed research.",
      normalizedTitle: `brief-${suffix}`,
      siteId: site.id,
      status: options.status ?? TopicStatus.BRIEF_READY,
      title: "Reliable workflow automation",
    },
  });
  const evidence = await database.topicEvidence.create({
    data: {
      collectedAt: new Date(),
      evidenceFingerprint: `${runToken}-${suffix}`,
      evidenceType: "SOURCE",
      excerpt: "Bounded retries improve workflow resilience.",
      sourceTitle: "Workflow reliability documentation",
      sourceUrl: `https://${site.domain}/reliability`,
      topicId: topic.id,
    },
  });
  const researchJob = await database.researchJob.create({
    data: {
      completedAt: new Date(),
      generatedNoteCount: options.usableNote === false ? 0 : 1,
      mode: ResearchMode.DETERMINISTIC,
      selectedEvidenceCount: 1,
      siteId: site.id,
      status: ResearchJobStatus.COMPLETED,
      successfulSourceCount: 1,
      topicId: topic.id,
      triggerType: ResearchTriggerType.INTERNAL_API,
    },
  });
  const source = await database.researchJobSource.create({
    data: {
      canonicalUrl: evidence.sourceUrl,
      contentFingerprint: "f".repeat(64),
      evidenceId: evidence.id,
      fetchedAt: new Date(),
      researchJobId: researchJob.id,
      selectionRank: 0,
      sourceTitle: evidence.sourceTitle,
      sourceUrl: evidence.sourceUrl,
      status: ResearchSourceStatus.SUCCEEDED,
    },
  });
  if (options.usableNote !== false) {
    await database.researchNote.create({
      data: {
        claims: [
          {
            claim: "Bounded retries improve workflow resilience.",
            collectedAt: new Date().toISOString(),
            confidence: "high",
            evidenceId: evidence.id,
            sourceTitle: evidence.sourceTitle,
            sourceUrl: evidence.sourceUrl,
            supportingExcerpt: "Bounded retries improve workflow resilience.",
          },
        ],
        contentFingerprint: "f".repeat(64),
        definitions: ["A bounded retry has a fixed attempt limit."],
        evidenceId: evidence.id,
        examples: ["Retry a temporary 503 once."],
        excerpts: ["Bounded retries improve workflow resilience."],
        fetchedAt: new Date(),
        mode: ResearchMode.DETERMINISTIC,
        openQuestions: ["Which retry limit fits each provider?"],
        researchJobId: researchJob.id,
        researchJobSourceId: source.id,
        risks: ["Retries can duplicate non-idempotent operations."],
        siteId: site.id,
        sourceTitle: evidence.sourceTitle ?? "Workflow source",
        sourceUrl: evidence.sourceUrl,
        statistics: [],
        summary:
          "Bounded retry policies improve resilience while limiting duplicate execution risk.",
        title: "Workflow reliability",
        topicId: topic.id,
      },
    });
  }
  return { evidence, researchJob, site, source, topic };
}

async function createJob(topicId: string, forceRegeneration = false) {
  return createBriefGenerationJob({
    correlationId: runToken,
    database,
    environment,
    request: {
      forceRegeneration,
      mode: "deterministic",
      regenerationReason: forceRegeneration ? "Test versioning" : undefined,
      triggerType: "internal_api",
    },
    topicId,
  });
}

describe("content brief database integration", () => {
  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required.");
    }
    database = getDatabaseClient(process.env.TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const sites = await database.site.findMany({
      select: { id: true },
      where: { domain: { startsWith: runToken } },
    });
    const siteIds = sites.map((site) => site.id);
    const entities = await database.auditLog.findMany({
      select: { entityId: true },
      where: {
        newValue: { path: ["correlationId"], equals: runToken },
      },
    });
    await database.auditLog.deleteMany({
      where: { entityId: { in: entities.map((item) => item.entityId) } },
    });
    await database.contentBrief.deleteMany({
      where: { siteId: { in: siteIds } },
    });
    await database.briefGenerationJob.deleteMany({
      where: { siteId: { in: siteIds } },
    });
    await database.site.deleteMany({ where: { id: { in: siteIds } } });
  });

  it("creates, generates, and idempotently replays version 1", async () => {
    const { topic } = await fixture({});
    const created = await createJob(topic.id);
    expect(created.job.status).toBe(BriefGenerationJobStatus.QUEUED);
    const generated = await generateContentBrief({
      correlationId: runToken,
      database,
      environment,
      jobId: created.job.id,
    });
    expect(generated.brief.version).toBe(1);
    expect(generated.brief.status).toBe(ContentBriefStatus.CURRENT);
    expect(
      (await database.topic.findUniqueOrThrow({ where: { id: topic.id } }))
        .status,
    ).toBe(TopicStatus.DRAFTING);
    const replay = await generateContentBrief({
      correlationId: runToken,
      database,
      environment,
      jobId: created.job.id,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(
      await database.contentBrief.count({ where: { topicId: topic.id } }),
    ).toBe(1);
    expect(
      await database.aiUsage.count({
        where: { briefGenerationJobId: created.job.id },
      }),
    ).toBe(1);
    const retriedCreation = await createJob(topic.id);
    expect(retriedCreation.idempotentReplay).toBe(true);
    expect(retriedCreation.brief?.id).toBe(generated.brief.id);
  });

  it("creates version 2 while preserving and superseding version 1", async () => {
    const { topic } = await fixture({});
    const firstJob = await createJob(topic.id);
    await generateContentBrief({
      correlationId: runToken,
      database,
      environment,
      jobId: firstJob.job.id,
    });
    const secondJob = await createJob(topic.id, true);
    const second = await generateContentBrief({
      correlationId: runToken,
      database,
      environment,
      jobId: secondJob.job.id,
    });
    expect(second.brief.version).toBe(2);
    const versions = await database.contentBrief.findMany({
      orderBy: { version: "asc" },
      where: { topicId: topic.id },
    });
    expect(versions.map((brief) => brief.status)).toEqual([
      ContentBriefStatus.SUPERSEDED,
      ContentBriefStatus.CURRENT,
    ]);
    expect(versions.filter((brief) => brief.currentTopicId).length).toBe(1);
  });

  it("prevents duplicate active jobs and rejects insufficient research", async () => {
    const { topic } = await fixture({});
    await createJob(topic.id);
    await expect(createJob(topic.id)).rejects.toMatchObject({
      code: "active_brief_job_exists",
    });

    const insufficient = await fixture({ usableNote: false });
    await expect(createJob(insufficient.topic.id)).rejects.toMatchObject({
      code: "insufficient_research",
    });
  });

  it("rejects fabricated provider references and does not transition topic", async () => {
    const { topic } = await fixture({});
    const created = await createJob(topic.id);
    const malicious: BriefProvider = {
      model: "fake-model",
      name: "fake",
      async generate(input: BriefProviderInput) {
        const valid = await new DeterministicBriefProvider().generate(input);
        valid.output.keyClaims[0].researchClaimId = `${input.snapshot.notes[0].noteId}:claim:999`;
        return valid;
      },
    };
    await expect(
      generateContentBrief({
        correlationId: runToken,
        database,
        environment,
        jobId: created.job.id,
        provider: malicious,
      }),
    ).rejects.toBeInstanceOf(ContentBriefError);
    expect(
      (await database.topic.findUniqueOrThrow({ where: { id: topic.id } }))
        .status,
    ).toBe(TopicStatus.BRIEF_READY);
    expect(
      (
        await database.briefGenerationJob.findUniqueOrThrow({
          where: { id: created.job.id },
        })
      ).status,
    ).toBe(BriefGenerationJobStatus.FAILED);
    expect(
      await database.contentBrief.count({ where: { topicId: topic.id } }),
    ).toBe(0);
  });

  it("excludes a research note linked to evidence from another topic", async () => {
    const first = await fixture({});
    const foreign = await fixture({});
    await database.researchNote.updateMany({
      data: { evidenceId: foreign.evidence.id },
      where: { topicId: first.topic.id },
    });

    await expect(createJob(first.topic.id)).rejects.toMatchObject({
      code: "insufficient_research",
    });
  });
});
