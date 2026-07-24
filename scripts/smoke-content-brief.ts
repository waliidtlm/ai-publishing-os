import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  ResearchJobStatus,
  ResearchMode,
  ResearchSourceStatus,
  ResearchTriggerType,
  TopicStatus,
  getDatabaseClient,
} from "@ai-publishing-os/database";
import { config } from "dotenv";

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

async function main() {
  const database = getDatabaseClient(databaseUrl);
  const token = `brief-smoke-${randomUUID()}`;
  const site = await database.site.create({
    data: {
      domain: `${token}.example.test`,
      name: "Content brief smoke site",
      targetAudience: "Automation engineers",
    },
  });
  const topic = await database.topic.create({
    data: {
      description: "A source-grounded guide to reliable workflow automation.",
      normalizedTitle: `${token}-valid`,
      siteId: site.id,
      status: TopicStatus.BRIEF_READY,
      title: "Reliable workflow automation",
    },
  });
  const insufficientTopic = await database.topic.create({
    data: {
      normalizedTitle: `${token}-insufficient`,
      siteId: site.id,
      status: TopicStatus.BRIEF_READY,
      title: "Insufficient research fixture",
    },
  });
  const evidence = await database.topicEvidence.create({
    data: {
      collectedAt: new Date(),
      evidenceFingerprint: `${token}-evidence`,
      evidenceType: "SOURCE",
      sourceTitle: "Workflow reliability source",
      sourceUrl: `https://${site.domain}/reliability`,
      topicId: topic.id,
    },
  });
  const researchJob = await database.researchJob.create({
    data: {
      completedAt: new Date(),
      generatedNoteCount: 1,
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
      contentFingerprint: "d".repeat(64),
      evidenceId: evidence.id,
      fetchedAt: new Date(),
      researchJobId: researchJob.id,
      selectionRank: 0,
      sourceTitle: evidence.sourceTitle,
      sourceUrl: evidence.sourceUrl,
      status: ResearchSourceStatus.SUCCEEDED,
    },
  });
  await database.researchNote.create({
    data: {
      claims: [
        {
          claim: "Bounded retries improve workflow reliability.",
          confidence: "high",
          evidenceId: evidence.id,
          sourceTitle: evidence.sourceTitle,
          sourceUrl: evidence.sourceUrl,
          supportingExcerpt: "Bounded retries improve workflow reliability.",
        },
      ],
      contentFingerprint: "d".repeat(64),
      definitions: ["A bounded retry has a fixed maximum attempt count."],
      evidenceId: evidence.id,
      examples: ["Retry a temporary 503 once."],
      excerpts: ["Bounded retries improve workflow reliability."],
      fetchedAt: new Date(),
      mode: ResearchMode.DETERMINISTIC,
      openQuestions: ["Which provider-specific limits apply?"],
      researchJobId: researchJob.id,
      researchJobSourceId: source.id,
      risks: ["Retries may duplicate non-idempotent operations."],
      siteId: site.id,
      sourceTitle: evidence.sourceTitle ?? "Workflow reliability source",
      sourceUrl: evidence.sourceUrl,
      statistics: [],
      summary:
        "Bounded retry policies support reliability while limiting repeated failures.",
      title: "Workflow reliability",
      topicId: topic.id,
    },
  });

  async function api(
    path: string,
    init: RequestInit = {},
    authenticated = true,
  ) {
    const headers = new Headers(init.headers);
    if (authenticated) headers.set("X-API-Key", apiKey!);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const body = (await response.json()) as Record<string, any>;
    return { body, status: response.status };
  }

  try {
    const unauthorized = await api(
      `/api/internal/topics/${topic.id}/brief-jobs`,
      { body: "{}", method: "POST" },
      false,
    );
    if (unauthorized.status !== 401)
      throw new Error("Expected authentication rejection.");

    const insufficient = await api(
      `/api/internal/topics/${insufficientTopic.id}/brief-jobs`,
      { body: JSON.stringify({ mode: "deterministic" }), method: "POST" },
    );
    if (insufficient.status !== 422)
      throw new Error(
        `Expected insufficient research rejection: ${JSON.stringify(insufficient)}`,
      );

    const created = await api(`/api/internal/topics/${topic.id}/brief-jobs`, {
      body: JSON.stringify({
        mode: "deterministic",
        triggerType: "internal_api",
      }),
      method: "POST",
    });
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    const jobId = created.body.data.job.id as string;

    const generated = await api(`/api/internal/brief-jobs/${jobId}/generate`, {
      body: "{}",
      method: "POST",
    });
    if (generated.body.data.brief.version !== 1)
      throw new Error("Version 1 was not generated.");

    const replay = await api(`/api/internal/brief-jobs/${jobId}/generate`, {
      body: "{}",
      method: "POST",
    });
    if (!replay.body.data.idempotentReplay)
      throw new Error("Identical generation was not replay-safe.");
    const createReplay = await api(
      `/api/internal/topics/${topic.id}/brief-jobs`,
      {
        body: JSON.stringify({ mode: "deterministic" }),
        method: "POST",
      },
    );
    if (
      createReplay.status !== 200 ||
      !createReplay.body.data.idempotentReplay
    ) {
      throw new Error("Identical job creation was not replay-safe.");
    }

    const regeneration = await api(
      `/api/internal/topics/${topic.id}/brief-jobs`,
      {
        body: JSON.stringify({
          forceRegeneration: true,
          mode: "deterministic",
          regenerationReason: "Smoke-test versioning",
        }),
        method: "POST",
      },
    );
    const versionTwo = await api(
      `/api/internal/brief-jobs/${regeneration.body.data.job.id}/generate`,
      { body: "{}", method: "POST" },
    );
    if (versionTwo.body.data.brief.version !== 2)
      throw new Error("Version 2 was not generated.");

    const briefs = await api(`/api/internal/topics/${topic.id}/briefs`);
    const versions = briefs.body.data.map(
      (brief: { version: number }) => brief.version,
    );
    const storedTopic = await database.topic.findUniqueOrThrow({
      where: { id: topic.id },
    });
    if (
      versions.join(",") !== "2,1" ||
      storedTopic.status !== TopicStatus.DRAFTING
    ) {
      throw new Error("Version history or topic transition is invalid.");
    }
    process.stdout.write(
      `${JSON.stringify({
        briefId: versionTwo.body.data.brief.id,
        provenanceRetained:
          versionTwo.body.data.brief.researchSnapshotFingerprint.length === 64,
        status: "passed",
        topicStatus: storedTopic.status.toLowerCase(),
        versions,
      })}\n`,
    );
  } finally {
    const jobs = await database.briefGenerationJob.findMany({
      select: { id: true, briefs: { select: { id: true } } },
      where: { siteId: site.id },
    });
    await database.auditLog.deleteMany({
      where: {
        entityId: {
          in: [
            topic.id,
            insufficientTopic.id,
            ...jobs.map((job) => job.id),
            ...jobs.flatMap((job) => job.briefs.map((brief) => brief.id)),
          ],
        },
      },
    });
    await database.contentBrief.deleteMany({ where: { siteId: site.id } });
    await database.briefGenerationJob.deleteMany({
      where: { siteId: site.id },
    });
    await database.site.delete({ where: { id: site.id } });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
