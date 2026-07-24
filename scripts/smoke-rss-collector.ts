import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getDatabaseClient } from "@ai-publishing-os/database";
import { config } from "dotenv";

import {
  createRssIdempotencyKey,
  parseRssOrAtom,
} from "../apps/dashboard/lib/rss/mapping";

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

async function main() {
  const database = getDatabaseClient(databaseUrl);
  const token = `rss-smoke-${randomUUID()}`;
  const site = await database.site.create({
    data: {
      domain: `${token}.example.test`,
      name: "RSS collector smoke test",
    },
  });
  const source = await database.sourceConfig.create({
    data: {
      baseUrl: "https://fixture.example/sample-feed.xml",
      collectionLimit: 20,
      collectionMethod: "RSS",
      name: "Local fixture RSS",
      siteId: site.id,
      sourceType: "RSS",
    },
  });

  async function api(
    path: string,
    init: RequestInit = {},
    submittedKey: string | null = internalApiKey,
  ) {
    const headers = new Headers(init.headers);

    if (submittedKey) headers.set("X-API-Key", submittedKey);
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

  async function startCollection() {
    const { body, response } = await api(
      `/api/internal/sources/${source.id}/collection-result`,
      {
        body: JSON.stringify({
          status: "started",
          workflowExecutionId: token,
        }),
        method: "POST",
      },
    );
    requireStatus("collection start", response.status, 201);

    const data = body.data as { runId?: string };
    if (!data.runId) throw new Error("Collection start did not return runId.");
    return data.runId;
  }

  try {
    const rss = parseRssOrAtom(
      await readFile(resolve("fixtures/rss/sample-feed.xml"), "utf8"),
      20,
    );
    const atom = parseRssOrAtom(
      await readFile(resolve("fixtures/rss/sample-atom.xml"), "utf8"),
      20,
    );

    if (rss.returnedCount !== 4 || atom.returnedCount !== 2) {
      throw new Error("Local RSS or Atom fixture parsing failed.");
    }

    requireStatus(
      "missing authentication",
      (await api("/api/internal/sources/rss", {}, null)).response.status,
      401,
    );
    requireStatus(
      "invalid authentication",
      (
        await api(
          "/api/internal/sources/rss",
          {},
          "invalid-internal-key-that-is-long-enough",
        )
      ).response.status,
      401,
    );

    const listed = await api("/api/internal/sources/rss");
    requireStatus("active source listing", listed.response.status, 200);
    const listedSources = (
      listed.body.data as { sources?: Array<{ id: string }> }
    ).sources;

    if (!listedSources?.some((entry) => entry.id === source.id)) {
      throw new Error(
        "The smoke RSS source was not returned by the list route.",
      );
    }

    const entries = rss.entries.slice(0, 2);
    const intakeResults: Array<{
      matchedExistingTopic: boolean;
      topicId: string;
    }> = [];

    for (const entry of entries) {
      const payload = {
        description: entry.description ?? undefined,
        externalId: entry.stableId,
        idempotencyKey: createRssIdempotencyKey(source.id, entry.stableId),
        metadata: {
          collector: "rss",
          feedUrl: source.baseUrl,
          publishedAt: entry.publishedAt,
        },
        siteId: site.id,
        source: {
          collectedAt: new Date().toISOString(),
          evidenceType: "source",
          excerpt: entry.excerpt ?? undefined,
          metadata: {
            author: entry.author,
            feedEntryId: entry.feedEntryId,
            publishedAt: entry.publishedAt,
            updatedAt: entry.updatedAt,
          },
          sourceConfigId: source.id,
          sourceTitle: entry.title,
          sourceUrl: entry.url,
        },
        title: entry.title,
      };
      const result = await api("/api/internal/topic-intake", {
        body: JSON.stringify(payload),
        method: "POST",
      });

      if (![200, 201].includes(result.response.status)) {
        throw new Error(`Topic Intake failed with ${result.response.status}.`);
      }

      intakeResults.push(
        (result.body.data ?? {}) as {
          matchedExistingTopic: boolean;
          topicId: string;
        },
      );

      const replay = await api("/api/internal/topic-intake", {
        body: JSON.stringify(payload),
        method: "POST",
      });
      requireStatus("idempotent replay", replay.response.status, 200);
    }

    const successRunId = await startCollection();
    requireStatus(
      "successful collection result",
      (
        await api(`/api/internal/sources/${source.id}/collection-result`, {
          body: JSON.stringify({
            acceptedCount: 2,
            discoveredCount: rss.discoveredCount,
            durationMs: 500,
            etag: '"fixture-v1"',
            failedCount: 0,
            httpStatus: 200,
            lastModified: "Fri, 24 Jul 2026 10:00:00 GMT",
            matchedCount: intakeResults.filter(
              (result) => result.matchedExistingTopic,
            ).length,
            returnedCount: rss.returnedCount,
            runId: successRunId,
            skippedCount: rss.skippedCount,
            status: "succeeded",
            submittedCount: 2,
          }),
          method: "POST",
        })
      ).response.status,
      200,
    );

    const partialRunId = await startCollection();
    requireStatus(
      "partial collection result",
      (
        await api(`/api/internal/sources/${source.id}/collection-result`, {
          body: JSON.stringify({
            acceptedCount: 1,
            discoveredCount: 2,
            durationMs: 250,
            errorCode: "topic_intake_partial_failure",
            errorSummary: "One entry failed validation.",
            failedCount: 1,
            httpStatus: 200,
            matchedCount: 0,
            returnedCount: 2,
            runId: partialRunId,
            skippedCount: 0,
            status: "partial",
            submittedCount: 2,
          }),
          method: "POST",
        })
      ).response.status,
      200,
    );

    const failedRunId = await startCollection();
    requireStatus(
      "failed collection result",
      (
        await api(`/api/internal/sources/${source.id}/collection-result`, {
          body: JSON.stringify({
            acceptedCount: 0,
            discoveredCount: 0,
            durationMs: 100,
            errorCode: "upstream_request_failed",
            errorSummary: "Authorization: Bearer must-not-be-stored",
            failedCount: 0,
            httpStatus: 503,
            matchedCount: 0,
            returnedCount: 0,
            runId: failedRunId,
            skippedCount: 0,
            status: "failed",
            submittedCount: 0,
          }),
          method: "POST",
        })
      ).response.status,
      200,
    );

    const [topicCount, evidenceCount, storedSource] = await Promise.all([
      database.topic.count({ where: { siteId: site.id } }),
      database.topicEvidence.count({
        where: { sourceConfigId: source.id },
      }),
      database.sourceConfig.findUniqueOrThrow({ where: { id: source.id } }),
    ]);

    if (topicCount !== 1 || evidenceCount !== 2) {
      throw new Error(
        `Expected one matched topic and two evidence rows; received ${topicCount} and ${evidenceCount}.`,
      );
    }

    if (storedSource.lastErrorSummary?.includes("must-not-be-stored")) {
      throw new Error("The stored collection error was not safely redacted.");
    }

    process.stdout.write(
      JSON.stringify(
        {
          atomEntries: atom.returnedCount,
          evidenceCount,
          rssEntries: rss.returnedCount,
          sourceListed: true,
          topicCount,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await database.site.delete({ where: { id: site.id } });
    await database.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
