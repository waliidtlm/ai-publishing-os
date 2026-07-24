import { randomUUID } from "node:crypto";

import {
  getDatabaseClient,
  type PrismaClient,
} from "@ai-publishing-os/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  listActiveRssSources,
  recordRssCollectionResult,
} from "../../apps/dashboard/lib/rss/service";

const runToken = `rss-${randomUUID()}`;
let database: PrismaClient;

async function createSite(suffix: string) {
  return database.site.create({
    data: {
      domain: `${runToken}-${suffix}.example.test`,
      name: `RSS integration ${suffix}`,
    },
  });
}

async function createSource(
  siteId: string,
  suffix: string,
  overrides: Record<string, unknown> = {},
) {
  return database.sourceConfig.create({
    data: {
      baseUrl: `https://feeds.example.test/${suffix}.xml`,
      collectionMethod: "RSS",
      name: `RSS source ${suffix}`,
      siteId,
      sourceType: "RSS",
      ...overrides,
    },
  });
}

async function startRun(sourceId: string) {
  return recordRssCollectionResult({
    correlationId: `${runToken}-correlation`,
    database,
    request: {
      status: "started",
      workflowExecutionId: `${runToken}-execution`,
    },
    sourceId,
  });
}

function completedRequest(
  runId: string,
  status: "succeeded" | "partial" | "failed" | "not_modified",
) {
  return {
    acceptedCount: status === "failed" ? 0 : 2,
    discoveredCount: status === "failed" ? 0 : 4,
    durationMs: 250,
    ...(status === "failed"
      ? {
          errorCode: "upstream_request_failed",
          errorSummary:
            "Authorization: Bearer should-never-be-stored?token=secret",
        }
      : {}),
    etag: '"fixture-v1"',
    failedCount: status === "partial" ? 1 : 0,
    httpStatus: status === "not_modified" ? 304 : 200,
    lastModified: "Fri, 24 Jul 2026 10:00:00 GMT",
    matchedCount: status === "failed" ? 0 : 1,
    returnedCount: status === "failed" ? 0 : 3,
    runId,
    skippedCount: status === "failed" ? 0 : 1,
    status,
    submittedCount: status === "failed" ? 0 : status === "partial" ? 3 : 2,
  } as const;
}

describe("RSS collector database integration", () => {
  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required.");
    }

    database = getDatabaseClient(process.env.TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await database.site.deleteMany({
      where: {
        domain: {
          startsWith: runToken,
        },
      },
    });
  });

  it("lists only active RSS sources with correct site associations", async () => {
    const firstSite = await createSite("list-first");
    const secondSite = await createSite("list-second");
    const first = await createSource(firstSite.id, "active-first");
    const second = await createSource(secondSite.id, "active-second");
    await createSource(firstSite.id, "inactive", { isActive: false });
    await database.sourceConfig.create({
      data: {
        collectionMethod: "MANUAL",
        name: "Manual source",
        siteId: firstSite.id,
        sourceType: "MANUAL",
      },
    });

    const listed = await listActiveRssSources(database, 100);
    const relevant = listed.filter((source) =>
      [first.id, second.id].includes(source.id),
    );

    expect(relevant).toHaveLength(2);
    expect(relevant).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          siteId: firstSite.id,
        }),
        expect.objectContaining({
          id: second.id,
          siteId: secondSite.id,
        }),
      ]),
    );
    expect(listed.some((source) => source.name === "RSS source inactive")).toBe(
      false,
    );
  });

  it.each(["succeeded", "partial", "failed", "not_modified"] as const)(
    "records a started then %s collection with source timestamps and audit",
    async (status) => {
      const site = await createSite(`result-${status}`);
      const source = await createSource(site.id, `result-${status}`);
      const started = await startRun(source.id);
      const completed = await recordRssCollectionResult({
        correlationId: `${runToken}-${status}`,
        database,
        request: completedRequest(started.runId, status),
        sourceId: source.id,
      });
      const [storedSource, storedRun, audits] = await Promise.all([
        database.sourceConfig.findUniqueOrThrow({
          where: { id: source.id },
        }),
        database.rssCollectionRun.findUniqueOrThrow({
          where: { id: started.runId },
        }),
        database.auditLog.findMany({
          where: {
            entityId: source.id,
            entityType: "source_config",
          },
        }),
      ]);

      expect(completed.status).toBe(status);
      expect(storedSource.lastCollectedAt).not.toBeNull();
      expect(storedRun.status.toLowerCase()).toBe(status);
      expect(audits.map((audit) => audit.action)).toEqual(
        expect.arrayContaining([
          "rss.source.collection_started",
          `rss.source.collection_${status === "succeeded" ? "succeeded" : status}`,
        ]),
      );

      if (status === "succeeded" || status === "not_modified") {
        expect(storedSource.lastSuccessfulCollectedAt).not.toBeNull();
        expect(storedSource.lastErrorSummary).toBeNull();
      } else {
        expect(storedSource.lastErrorAt).not.toBeNull();
      }

      if (status === "failed") {
        expect(storedSource.lastErrorSummary).not.toContain(
          "should-never-be-stored",
        );
        expect(JSON.stringify(audits)).not.toContain("should-never-be-stored");
      }
    },
  );

  it("rejects unknown, inactive, and non-RSS sources", async () => {
    const site = await createSite("reject");
    const inactive = await createSource(site.id, "inactive-result", {
      isActive: false,
    });
    const manual = await database.sourceConfig.create({
      data: {
        collectionMethod: "MANUAL",
        name: "Manual result target",
        siteId: site.id,
        sourceType: "MANUAL",
      },
    });

    await expect(startRun("clh1x2y3z9999qwertyuiopas")).rejects.toMatchObject({
      code: "rss_source_not_found",
    });
    await expect(startRun(inactive.id)).rejects.toMatchObject({
      code: "inactive_rss_source",
    });
    await expect(startRun(manual.id)).rejects.toMatchObject({
      code: "source_not_rss",
    });
  });
});
