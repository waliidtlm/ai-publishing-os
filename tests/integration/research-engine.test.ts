import { randomUUID } from "node:crypto";

import {
  ResearchMode,
  TopicStatus,
  getDatabaseClient,
  type PrismaClient,
} from "@ai-publishing-os/database";
import type { ResearchEnvironment } from "@ai-publishing-os/schemas";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ResearchError } from "../../apps/dashboard/lib/research/errors";
import type { ResearchProvider } from "../../apps/dashboard/lib/research/providers/types";
import {
  completeResearchJob,
  createResearchJob,
  processResearchSource,
} from "../../apps/dashboard/lib/research/service";

const runToken = `research-${randomUUID()}`;
const createdEntityIds = new Set<string>();
let database: PrismaClient;

const environment: ResearchEnvironment = {
  AI_MODEL_RESEARCH: "test-model",
  AI_PROVIDER: "openai",
  RESEARCH_AI_ENABLED: false,
  RESEARCH_ALLOW_DETERMINISTIC_FALLBACK: false,
  RESEARCH_DEFAULT_MODE: "deterministic",
  RESEARCH_MAX_CLAIMS_PER_SOURCE: 10,
  RESEARCH_MAX_CONCURRENT_AI_PER_SITE: 1,
  RESEARCH_MAX_CONCURRENT_FETCHES: 2,
  RESEARCH_MAX_EXCERPT_CHARS: 500,
  RESEARCH_MAX_INPUT_CHARS: 100_000,
  RESEARCH_MAX_NOTES_PER_JOB: 5,
  RESEARCH_MAX_OUTPUT_TOKENS: 2_500,
  RESEARCH_MAX_REDIRECTS: 3,
  RESEARCH_MAX_RESPONSE_BYTES: 2_097_152,
  RESEARCH_MAX_SOURCES_PER_JOB: 10,
  RESEARCH_REQUEST_TIMEOUT_MS: 15_000,
};

const publicLookup = async () => [
  {
    address: "93.184.216.34",
    family: 4,
  },
];

function article(label: string) {
  return `<!doctype html>
    <html><head><title>${label}</title></head><body><article>
      <h1>${label}</h1>
      <p>Queue-based execution separates accepting workflow requests from running the work for ${label}.</p>
      <p>Bounded worker concurrency protects downstream systems during traffic spikes and supports reliable operations.</p>
    </article></body></html>`;
}

async function createTopic(options: {
  evidenceUrls?: string[];
  status?: TopicStatus;
  suffix: string;
}) {
  const site = await database.site.create({
    data: {
      domain: `${runToken}-${options.suffix}.example.test`,
      name: `Research site ${options.suffix}`,
      sourceConfigs: {
        create: [
          {
            baseUrl: `https://docs-${options.suffix}.example.test`,
            collectionMethod: "CRAWL",
            name: "Approved website",
            sourceType: "WEBSITE",
          },
        ],
      },
    },
  });
  const topic = await database.topic.create({
    data: {
      normalizedTitle: `research-${options.suffix}`,
      siteId: site.id,
      status: options.status ?? TopicStatus.APPROVED,
      title: `Research ${options.suffix}`,
    },
  });

  for (const [index, sourceUrl] of (
    options.evidenceUrls ?? [
      `https://articles-${options.suffix}.example.test/one`,
    ]
  ).entries()) {
    await database.topicEvidence.create({
      data: {
        collectedAt: new Date(),
        evidenceFingerprint: `${runToken}-${options.suffix}-${index}`,
        evidenceType: "SOURCE",
        sourceTitle: `Evidence ${index + 1}`,
        sourceUrl,
        topicId: topic.id,
      },
    });
  }

  createdEntityIds.add(topic.id);
  return { site, topic };
}

function fixtureFetch(options: {
  failures?: ReadonlySet<string>;
  label?: string;
}) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = input.toString();

    if (
      options.failures?.has(url) ||
      options.failures?.has(url.replace(/\/$/u, ""))
    ) {
      return new Response("PDF fixture", {
        headers: { "content-type": "application/pdf" },
      });
    }

    return new Response(article(options.label ?? url), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}

async function createJob(topicId: string, override = environment) {
  const result = await createResearchJob({
    correlationId: runToken,
    database,
    environment: override,
    request: {
      mode: override.RESEARCH_DEFAULT_MODE,
      triggerType: "internal_api",
    },
    topicId,
  });

  createdEntityIds.add(result.job.id);
  for (const source of result.sources) {
    const stored = await database.researchJobSource.findUniqueOrThrow({
      where: {
        researchJobId_canonicalUrl: {
          canonicalUrl: source.canonicalUrl,
          researchJobId: result.job.id,
        },
      },
    });
    createdEntityIds.add(stored.id);
  }

  return result;
}

describe("research engine database integration", () => {
  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required.");
    }

    database = getDatabaseClient(process.env.TEST_DATABASE_URL);
  });

  afterAll(async () => {
    const jobs = await database.researchJob.findMany({
      select: {
        id: true,
        notes: { select: { id: true } },
        sources: { select: { id: true } },
      },
      where: {
        site: {
          domain: { startsWith: runToken },
        },
      },
    });

    for (const job of jobs) {
      createdEntityIds.add(job.id);
      job.notes.forEach((note) => createdEntityIds.add(note.id));
      job.sources.forEach((source) => createdEntityIds.add(source.id));
    }

    await database.auditLog.deleteMany({
      where: { entityId: { in: [...createdEntityIds] } },
    });
    await database.site.deleteMany({
      where: { domain: { startsWith: runToken } },
    });
  });

  it("rejects ineligible topics and prevents a duplicate active job", async () => {
    const rejected = await createTopic({
      status: TopicStatus.REJECTED,
      suffix: "ineligible",
    });

    await expect(createJob(rejected.topic.id)).rejects.toMatchObject({
      code: "ineligible_topic",
    });

    const eligible = await createTopic({ suffix: "duplicate" });
    await createJob(eligible.topic.id);
    await expect(createJob(eligible.topic.id)).rejects.toMatchObject({
      code: "active_research_job_exists",
    });
  });

  it("selects only same-site evidence and approved source configurations", async () => {
    const first = await createTopic({ suffix: "boundary-first" });
    const second = await createTopic({ suffix: "boundary-second" });
    const result = await createJob(first.topic.id);

    const sources = await database.researchJobSource.findMany({
      where: { researchJobId: result.job.id },
    });

    expect(sources).toHaveLength(2);
    expect(
      sources.every((source) => source.sourceUrl.includes("boundary-first")),
    ).toBe(true);
    expect(
      sources.some((source) => source.sourceUrl.includes("boundary-second")),
    ).toBe(false);
    expect(second.site.id).not.toBe(first.site.id);
  });

  it("creates one deterministic note, preserves claim provenance, and replays without duplication", async () => {
    const { topic } = await createTopic({ suffix: "success" });
    const job = await createJob(topic.id);
    const source = await database.researchJobSource.findFirstOrThrow({
      where: {
        evidenceId: { not: null },
        researchJobId: job.job.id,
      },
    });
    const fetchImplementation = fixtureFetch({ label: "Success fixture" });
    const first = await processResearchSource({
      correlationId: runToken,
      database,
      environment,
      fetchImplementation,
      lookup: publicLookup,
      researchJobId: job.job.id,
      sourceId: source.id,
    });
    const replay = await processResearchSource({
      correlationId: runToken,
      database,
      environment,
      fetchImplementation,
      lookup: publicLookup,
      researchJobId: job.job.id,
      sourceId: source.id,
    });
    const notes = await database.researchNote.findMany({
      where: { researchJobSourceId: source.id },
    });
    const claims = notes[0]?.claims as Array<Record<string, unknown>>;

    expect(first.status).toBe("succeeded");
    if (first.status !== "succeeded") {
      throw new Error("Expected successful research processing.");
    }
    expect(replay).toMatchObject({
      idempotentReplay: true,
      noteId: first.noteId,
    });
    expect(notes).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      evidenceId: source.evidenceId,
      sourceUrl: source.sourceUrl,
    });
    expect(claims[0]?.supportingExcerpt).toBeTruthy();
    expect(notes[0]?.metadata).toMatchObject({
      deterministicMode: true,
      sourceContentStored: false,
    });
  });

  it("versions changed content without duplicating unchanged content", async () => {
    const { topic } = await createTopic({ suffix: "version" });
    const job = await createJob(topic.id);
    const source = await database.researchJobSource.findFirstOrThrow({
      where: { evidenceId: { not: null }, researchJobId: job.job.id },
    });

    await processResearchSource({
      correlationId: runToken,
      database,
      environment,
      fetchImplementation: fixtureFetch({ label: "Version one" }),
      lookup: publicLookup,
      researchJobId: job.job.id,
      sourceId: source.id,
    });
    await processResearchSource({
      correlationId: runToken,
      database,
      environment,
      fetchImplementation: fixtureFetch({ label: "Version two changed" }),
      lookup: publicLookup,
      researchJobId: job.job.id,
      sourceId: source.id,
    });

    const notes = await database.researchNote.findMany({
      orderBy: { version: "asc" },
      where: { researchJobSourceId: source.id },
    });
    expect(notes.map((note) => note.version)).toEqual([1, 2]);
    expect(notes[0]?.contentFingerprint).not.toBe(notes[1]?.contentFingerprint);
  });

  it("records partial completion and moves to brief-ready only with a usable note", async () => {
    const failedUrl = "https://partial.example.test/fail.pdf";
    const { topic } = await createTopic({
      evidenceUrls: ["https://partial.example.test/success", failedUrl],
      suffix: "partial",
    });
    const job = await createJob(topic.id);
    const sources = await database.researchJobSource.findMany({
      where: { researchJobId: job.job.id },
    });
    const fetchImplementation = fixtureFetch({
      failures: new Set([failedUrl]),
      label: "Partial success",
    });

    for (const source of sources) {
      await processResearchSource({
        correlationId: runToken,
        database,
        environment,
        fetchImplementation,
        lookup: publicLookup,
        researchJobId: job.job.id,
        sourceId: source.id,
      });
    }

    const completed = await completeResearchJob({
      correlationId: runToken,
      database,
      request: {},
      researchJobId: job.job.id,
    });
    const storedTopic = await database.topic.findUniqueOrThrow({
      where: { id: topic.id },
    });

    expect(completed.status).toBe("PARTIAL");
    expect(completed.generatedNoteCount).toBeGreaterThan(0);
    expect(completed.failedSourceCount).toBeGreaterThan(0);
    expect(storedTopic.status).toBe(TopicStatus.BRIEF_READY);
  });

  it("records full failure and does not move the topic to brief-ready", async () => {
    const failedUrl = "https://failed.example.test/file.pdf";
    const { topic } = await createTopic({
      evidenceUrls: [failedUrl],
      suffix: "failed",
    });
    const job = await createJob(topic.id);
    const sources = await database.researchJobSource.findMany({
      where: { researchJobId: job.job.id },
    });
    const fetchImplementation = fixtureFetch({
      failures: new Set(sources.map((source) => source.sourceUrl)),
    });

    for (const source of sources) {
      await processResearchSource({
        correlationId: runToken,
        database,
        environment,
        fetchImplementation,
        lookup: publicLookup,
        researchJobId: job.job.id,
        sourceId: source.id,
      });
    }

    const completed = await completeResearchJob({
      correlationId: runToken,
      database,
      request: {},
      researchJobId: job.job.id,
    });
    const storedTopic = await database.topic.findUniqueOrThrow({
      where: { id: topic.id },
    });

    expect(completed.status).toBe("FAILED");
    expect(completed.generatedNoteCount).toBe(0);
    expect(storedTopic.status).toBe(TopicStatus.FAILED);
  });

  it("records one provider-neutral AI usage row and does not repeat it on replay", async () => {
    const openAiEnvironment: ResearchEnvironment = {
      ...environment,
      AI_API_KEY: "test-api-key-that-is-not-used-externally",
      RESEARCH_AI_ENABLED: true,
      RESEARCH_DEFAULT_MODE: "openai",
    };
    const { topic } = await createTopic({ suffix: "ai-usage" });
    const job = await createJob(topic.id, openAiEnvironment);
    const source = await database.researchJobSource.findFirstOrThrow({
      where: { evidenceId: { not: null }, researchJobId: job.job.id },
    });
    const fakeProvider: ResearchProvider = {
      generate: vi.fn(async (input) => ({
        output: {
          definitions: [],
          examples: [],
          keyClaims: [
            {
              claim: "Queue-based execution separates requests from work.",
              confidence: "high" as const,
              supportingExcerpt:
                "Queue-based execution separates accepting workflow requests from running the work",
            },
          ],
          openQuestions: [],
          risks: [],
          statistics: [],
          summary: "Structured fake-provider research.",
        },
        usage: {
          estimatedCostUsd: null,
          inputTokens: input.sourceText.length,
          outputTokens: 30,
        },
      })),
      mode: ResearchMode.OPENAI,
      model: "fake-openai-model",
      name: "openai",
    };
    const fetchImplementation = fixtureFetch({ label: "AI usage" });

    await processResearchSource({
      correlationId: runToken,
      database,
      environment: openAiEnvironment,
      fetchImplementation,
      lookup: publicLookup,
      provider: fakeProvider,
      researchJobId: job.job.id,
      sourceId: source.id,
    });
    await processResearchSource({
      correlationId: runToken,
      database,
      environment: openAiEnvironment,
      fetchImplementation,
      lookup: publicLookup,
      provider: fakeProvider,
      researchJobId: job.job.id,
      sourceId: source.id,
    });

    const usage = await database.aiUsage.findMany({
      where: { researchJobId: job.job.id },
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      provider: "openai",
      status: "SUCCEEDED",
    });
    expect(fakeProvider.generate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(usage)).not.toContain("test-api-key");
  });

  it("records invalid AI output safely without partial note records", async () => {
    const openAiEnvironment: ResearchEnvironment = {
      ...environment,
      AI_API_KEY: "test-api-key-that-is-not-used-externally",
      RESEARCH_AI_ENABLED: true,
      RESEARCH_DEFAULT_MODE: "openai",
    };
    const { topic } = await createTopic({ suffix: "invalid-ai" });
    const job = await createJob(topic.id, openAiEnvironment);
    const source = await database.researchJobSource.findFirstOrThrow({
      where: { evidenceId: { not: null }, researchJobId: job.job.id },
    });
    const invalidProvider: ResearchProvider = {
      async generate() {
        throw new ResearchError(
          "ai_invalid_output",
          "Invalid structured output.",
          502,
        );
      },
      mode: ResearchMode.OPENAI,
      model: "fake-invalid-model",
      name: "openai",
    };

    const result = await processResearchSource({
      correlationId: runToken,
      database,
      environment: openAiEnvironment,
      fetchImplementation: fixtureFetch({ label: "Invalid AI" }),
      lookup: publicLookup,
      provider: invalidProvider,
      researchJobId: job.job.id,
      sourceId: source.id,
    });

    expect(result).toMatchObject({
      error: { code: "ai_invalid_output" },
      status: "failed",
    });
    expect(
      await database.researchNote.count({
        where: { researchJobSourceId: source.id },
      }),
    ).toBe(0);
    expect(
      await database.aiUsage.findFirstOrThrow({
        where: { researchJobSourceId: source.id },
      }),
    ).toMatchObject({
      errorCode: "ai_invalid_output",
      status: "FAILED",
    });
  });
});
