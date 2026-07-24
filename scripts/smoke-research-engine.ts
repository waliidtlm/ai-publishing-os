import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { TopicStatus, getDatabaseClient } from "@ai-publishing-os/database";
import { researchEnvironmentSchema } from "@ai-publishing-os/schemas";
import { config } from "dotenv";

import { processResearchSource } from "../apps/dashboard/lib/research/service";

config({
  path: resolve(process.cwd(), "apps/dashboard/.env.local"),
  quiet: true,
});

const baseUrl =
  process.env.AI_PUBLISHING_OS_BASE_URL ?? "http://localhost:3000";
const apiKey = process.env.INTERNAL_API_KEY;
const databaseUrl = process.env.DATABASE_URL;

if (!apiKey || !databaseUrl) {
  throw new Error("INTERNAL_API_KEY and DATABASE_URL are required.");
}

const internalApiKey = apiKey;
const researchEnvironment = researchEnvironmentSchema.parse(process.env);
const publicLookup = async () => [
  {
    address: "93.184.216.34",
    family: 4,
  },
];

async function main() {
  const database = getDatabaseClient(databaseUrl);
  const token = `research-smoke-${randomUUID()}`;
  const fixture = await readFile(
    resolve("fixtures/research/normal-article.html"),
    "utf8",
  );
  const site = await database.site.create({
    data: {
      domain: `${token}.example.test`,
      name: "Research engine smoke test",
    },
  });
  const topic = await database.topic.create({
    data: {
      normalizedTitle: `${token}-partial`,
      siteId: site.id,
      status: TopicStatus.APPROVED,
      title: "Research engine deterministic smoke test",
      evidence: {
        create: [
          {
            collectedAt: new Date(),
            evidenceFingerprint: `${token}-success`,
            evidenceType: "SOURCE",
            sourceTitle: "Local HTML fixture",
            sourceUrl: "https://fixture.example.test/article",
          },
          {
            collectedAt: new Date(),
            evidenceFingerprint: `${token}-failure`,
            evidenceType: "SOURCE",
            sourceTitle: "Unsupported PDF fixture",
            sourceUrl: "https://fixture.example.test/file.pdf",
          },
        ],
      },
    },
  });
  const failedTopic = await database.topic.create({
    data: {
      normalizedTitle: `${token}-failed`,
      siteId: site.id,
      status: TopicStatus.APPROVED,
      title: "Research engine failed smoke test",
      evidence: {
        create: {
          collectedAt: new Date(),
          evidenceFingerprint: `${token}-all-failed`,
          evidenceType: "SOURCE",
          sourceTitle: "Unsupported source",
          sourceUrl: "https://fixture.example.test/unsupported.pdf",
        },
      },
    },
  });
  const auditEntityIds = new Set<string>([topic.id, failedTopic.id]);

  async function api(
    path: string,
    init: RequestInit = {},
    key: string | null = internalApiKey,
  ) {
    const headers = new Headers(init.headers);

    if (key) headers.set("X-API-Key", key);
    if (init.body) headers.set("Content-Type", "application/json");

    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers,
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { body, response };
  }

  function requireStatus(label: string, actual: number, expected: number) {
    if (actual !== expected) {
      throw new Error(`${label}: expected ${expected}, received ${actual}.`);
    }
  }

  async function createJob(topicId: string) {
    const result = await api(`/api/internal/topics/${topicId}/research-jobs`, {
      body: JSON.stringify({
        mode: "deterministic",
        triggerType: "manual",
      }),
      method: "POST",
    });
    requireStatus("research job creation", result.response.status, 201);
    const data = result.body.data as {
      job?: { id?: string };
    };

    if (!data.job?.id) {
      throw new Error("Research job creation did not return a job ID.");
    }

    auditEntityIds.add(data.job.id);
    return data.job.id;
  }

  try {
    requireStatus(
      "missing authentication",
      (
        await api(
          `/api/internal/topics/${topic.id}/research-jobs`,
          {
            body: JSON.stringify({ mode: "deterministic" }),
            method: "POST",
          },
          null,
        )
      ).response.status,
      401,
    );

    const jobId = await createJob(topic.id);
    requireStatus(
      "duplicate active job",
      (
        await api(`/api/internal/topics/${topic.id}/research-jobs`, {
          body: JSON.stringify({ mode: "deterministic" }),
          method: "POST",
        })
      ).response.status,
      409,
    );
    const sources = await database.researchJobSource.findMany({
      orderBy: { selectionRank: "asc" },
      where: { researchJobId: jobId },
    });

    if (sources.length !== 2) {
      throw new Error(`Expected two selected sources, got ${sources.length}.`);
    }

    sources.forEach((source) => auditEntityIds.add(source.id));
    const successfulSource = sources.find((source) =>
      source.sourceUrl.endsWith("/article"),
    );
    const failedSource = sources.find((source) =>
      source.sourceUrl.endsWith(".pdf"),
    );

    if (!successfulSource || !failedSource) {
      throw new Error("The expected selected evidence was not loaded.");
    }

    const successfulFetch = async () =>
      new Response(fixture, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    const processed = await processResearchSource({
      correlationId: token,
      database,
      environment: researchEnvironment,
      fetchImplementation: successfulFetch,
      lookup: publicLookup,
      researchJobId: jobId,
      sourceId: successfulSource.id,
    });
    const replayed = await processResearchSource({
      correlationId: token,
      database,
      environment: researchEnvironment,
      fetchImplementation: successfulFetch,
      lookup: publicLookup,
      researchJobId: jobId,
      sourceId: successfulSource.id,
    });
    const failed = await processResearchSource({
      correlationId: token,
      database,
      environment: researchEnvironment,
      fetchImplementation: async () =>
        new Response("PDF", {
          headers: { "content-type": "application/pdf" },
        }),
      lookup: publicLookup,
      researchJobId: jobId,
      sourceId: failedSource.id,
    });

    if (
      processed.status !== "succeeded" ||
      replayed.status !== "succeeded" ||
      !replayed.idempotentReplay ||
      failed.status !== "failed"
    ) {
      throw new Error("Source processing or deterministic replay failed.");
    }

    const completed = await api(
      `/api/internal/research-jobs/${jobId}/complete`,
      {
        body: JSON.stringify({}),
        method: "POST",
      },
    );
    requireStatus("partial completion", completed.response.status, 200);
    const status = await api(`/api/internal/research-jobs/${jobId}`);
    requireStatus("research result read", status.response.status, 200);
    const storedJob = status.body.data as {
      generatedNoteCount?: number;
      notes?: Array<{
        claims?: Array<{
          evidenceId?: string;
          sourceUrl?: string;
          supportingExcerpt?: string;
        }>;
        id?: string;
        metadata?: { deterministicMode?: boolean };
      }>;
      status?: string;
    };

    if (
      storedJob.status !== "PARTIAL" ||
      storedJob.generatedNoteCount !== 1 ||
      storedJob.notes?.length !== 1 ||
      !storedJob.notes[0]?.metadata?.deterministicMode ||
      !storedJob.notes[0]?.claims?.[0]?.evidenceId ||
      !storedJob.notes[0]?.claims?.[0]?.supportingExcerpt
    ) {
      throw new Error(
        "Stored partial research result or provenance is invalid.",
      );
    }

    if (storedJob.notes[0]?.id) auditEntityIds.add(storedJob.notes[0].id);

    const failedJobId = await createJob(failedTopic.id);
    const allFailedSource = await database.researchJobSource.findFirstOrThrow({
      where: { researchJobId: failedJobId },
    });
    auditEntityIds.add(allFailedSource.id);
    await processResearchSource({
      correlationId: token,
      database,
      environment: researchEnvironment,
      fetchImplementation: async () =>
        new Response("PDF", {
          headers: { "content-type": "application/pdf" },
        }),
      lookup: publicLookup,
      researchJobId: failedJobId,
      sourceId: allFailedSource.id,
    });
    const allFailed = await api(
      `/api/internal/research-jobs/${failedJobId}/complete`,
      {
        body: JSON.stringify({}),
        method: "POST",
      },
    );
    requireStatus("full failure completion", allFailed.response.status, 200);

    const [storedTopic, storedFailedTopic, noteCount] = await Promise.all([
      database.topic.findUniqueOrThrow({ where: { id: topic.id } }),
      database.topic.findUniqueOrThrow({ where: { id: failedTopic.id } }),
      database.researchNote.count({
        where: { researchJobSourceId: successfulSource.id },
      }),
    ]);

    if (
      storedTopic.status !== TopicStatus.BRIEF_READY ||
      storedFailedTopic.status !== TopicStatus.FAILED ||
      noteCount !== 1
    ) {
      throw new Error(
        "Topic transitions or idempotent note count are invalid.",
      );
    }

    process.stdout.write(
      `${JSON.stringify({
        failedJobId,
        jobId,
        noteCount,
        partialStatus: storedJob.status,
        status: "research-engine-smoke-passed",
      })}\n`,
    );
  } finally {
    const jobs = await database.researchJob.findMany({
      select: {
        id: true,
        notes: { select: { id: true } },
        sources: { select: { id: true } },
      },
      where: { siteId: site.id },
    });

    for (const job of jobs) {
      auditEntityIds.add(job.id);
      job.notes.forEach((note) => auditEntityIds.add(note.id));
      job.sources.forEach((source) => auditEntityIds.add(source.id));
    }

    await database.auditLog.deleteMany({
      where: { entityId: { in: [...auditEntityIds] } },
    });
    await database.site.delete({ where: { id: site.id } });
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      status: "research-engine-smoke-failed",
    })}\n`,
  );
  process.exitCode = 1;
});
