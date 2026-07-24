import { randomUUID } from "node:crypto";

import {
  getDatabaseClient,
  TopicPriority,
  TopicStatus,
} from "@ai-publishing-os/database";
import {
  topicIntakeRequestSchema,
  type TopicIntakeRequest,
} from "@ai-publishing-os/schemas";
import { afterAll, describe, expect, it } from "vitest";

import { IdempotencyConflictError } from "../../apps/dashboard/lib/topic-intake/errors";
import { processTopicIntake } from "../../apps/dashboard/lib/topic-intake/service";
import { PostgresInternalApiRateLimiter } from "../../apps/dashboard/lib/internal-api/postgres-rate-limit";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseSuite = testDatabaseUrl ? describe : describe.skip;
const database = testDatabaseUrl
  ? getDatabaseClient(testDatabaseUrl)
  : undefined;
const runToken = randomUUID().replaceAll("-", "");
const createdSiteIds: string[] = [];
const rateLimitScope = `topic-intake-test-${runToken}`;

function requireDatabase() {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required for database tests.");
  }

  return database;
}

async function createSite(label: string) {
  const site = await requireDatabase().site.create({
    data: {
      domain: `${label}-${runToken}.example.test`,
      name: `Integration ${label}`,
    },
  });

  createdSiteIds.push(site.id);
  return site;
}

function intake(request: TopicIntakeRequest, correlationId = randomUUID()) {
  return processTopicIntake({
    correlationId,
    database: requireDatabase(),
    request,
  });
}

function requestFor(
  siteId: string,
  idempotencyKey: string,
  overrides: Partial<TopicIntakeRequest> = {},
): TopicIntakeRequest {
  return topicIntakeRequestSchema.parse({
    idempotencyKey,
    siteId,
    title: "How to prevent duplicate executions in n8n",
    ...overrides,
  });
}

databaseSuite("topic intake transaction", () => {
  afterAll(async () => {
    if (!database) {
      return;
    }

    await database.auditLog.deleteMany({
      where: {
        action: {
          in: [
            "topic.intake.created",
            "topic.intake.matched_existing",
            "topic.evidence.created",
            "topic.evidence.duplicate_ignored",
          ],
        },
      },
    });
    await database.intakeIdempotencyRecord.deleteMany({
      where: {
        scope: {
          in: createdSiteIds.map(
            (siteId) => `topic-intake:${siteId}:internal-api`,
          ),
        },
      },
    });
    await database.internalApiRateLimitBucket.deleteMany({
      where: {
        scope: rateLimitScope,
      },
    });
    await database.site.deleteMany({
      where: {
        id: {
          in: createdSiteIds,
        },
      },
    });
    await database.$disconnect();
  });

  it("creates a candidate topic", async () => {
    const site = await createSite("create-topic");
    const response = await intake(
      requestFor(site.id, `${runToken}-create-topic`),
    );
    const topic = await requireDatabase().topic.findUnique({
      where: {
        id: response.result.topicId,
      },
    });

    expect(response.httpStatus).toBe(201);
    expect(response.result).toMatchObject({
      evidenceCreated: false,
      evidenceId: null,
      matchedExistingTopic: false,
      status: "candidate",
      topicCreated: true,
    });
    expect(topic).toMatchObject({
      intakeOrigin: "internal_api",
      normalizedTitle: "how to prevent duplicate executions in n8n",
      status: TopicStatus.CANDIDATE,
    });
  });

  it("creates optional evidence atomically", async () => {
    const site = await createSite("create-evidence");
    const response = await intake(
      requestFor(site.id, `${runToken}-create-evidence`, {
        externalId: "manual-source-1",
        source: {
          evidenceType: "manual",
          sourceTitle: "Manual evidence",
          sourceUrl: "https://example.com/evidence",
        },
      }),
    );

    expect(response.result.evidenceCreated).toBe(true);
    expect(
      await requireDatabase().topicEvidence.findUnique({
        where: {
          id: response.result.evidenceId ?? "",
        },
      }),
    ).toMatchObject({
      externalId: "manual-source-1",
      sourceUrl: "https://example.com/evidence",
      topicId: response.result.topicId,
    });
  });

  it("matches an existing normalized title and preserves its fields", async () => {
    const site = await createSite("match-topic");
    const first = await intake(
      requestFor(site.id, `${runToken}-match-first`, {
        description: "Original description",
      }),
    );
    await requireDatabase().topic.update({
      data: {
        priority: TopicPriority.HIGH,
        status: TopicStatus.REVIEWING,
        totalScore: 42,
      },
      where: {
        id: first.result.topicId,
      },
    });

    const matched = await intake(
      requestFor(site.id, `${runToken}-match-second`, {
        description: "Must not overwrite",
        title: "  HOW   TO PREVENT DUPLICATE EXECUTIONS IN N8N? ",
      }),
    );
    const topic = await requireDatabase().topic.findUniqueOrThrow({
      where: {
        id: first.result.topicId,
      },
    });

    expect(matched.httpStatus).toBe(200);
    expect(matched.result).toMatchObject({
      matchedExistingTopic: true,
      status: "reviewing",
      topicCreated: false,
      topicId: first.result.topicId,
    });
    expect(topic).toMatchObject({
      description: "Original description",
      priority: TopicPriority.HIGH,
      status: TopicStatus.REVIEWING,
      totalScore: 42,
    });
  });

  it("allows the same normalized title on different sites", async () => {
    const firstSite = await createSite("site-scope-first");
    const secondSite = await createSite("site-scope-second");
    const [first, second] = await Promise.all([
      intake(requestFor(firstSite.id, `${runToken}-site-first`)),
      intake(requestFor(secondSite.id, `${runToken}-site-second`)),
    ]);

    expect(first.result.topicId).not.toBe(second.result.topicId);
    expect(first.result.topicCreated).toBe(true);
    expect(second.result.topicCreated).toBe(true);
  });

  it("replays the same idempotency key without repeating side effects", async () => {
    const site = await createSite("replay");
    const request = requestFor(site.id, `${runToken}-replay`, {
      source: {
        evidenceType: "manual",
        sourceUrl: "https://example.com/replay",
      },
    });
    const first = await intake(request);
    const replay = await intake(request);

    expect(replay.httpStatus).toBe(200);
    expect(replay.result).toEqual({
      ...first.result,
      idempotentReplay: true,
    });
    expect(
      await requireDatabase().topic.count({
        where: {
          siteId: site.id,
        },
      }),
    ).toBe(1);
    expect(
      await requireDatabase().topicEvidence.count({
        where: {
          topicId: first.result.topicId,
        },
      }),
    ).toBe(1);
  });

  it("rejects materially different data for the same idempotency key", async () => {
    const site = await createSite("conflict");
    const key = `${runToken}-conflict`;
    await intake(requestFor(site.id, key));

    await expect(
      intake(
        requestFor(site.id, key, {
          title: "A materially different title",
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("does not create duplicate evidence", async () => {
    const site = await createSite("duplicate-evidence");
    const first = await intake(
      requestFor(site.id, `${runToken}-evidence-first`, {
        source: {
          evidenceType: "manual",
          sourceUrl: "https://example.com/path/?b=2&a=1#first",
        },
      }),
    );
    const second = await intake(
      requestFor(site.id, `${runToken}-evidence-second`, {
        source: {
          evidenceType: "manual",
          sourceUrl: "https://example.com/path?a=1&b=2",
        },
      }),
    );

    expect(second.result).toMatchObject({
      evidenceCreated: false,
      evidenceId: first.result.evidenceId,
    });
    expect(
      await requireDatabase().topicEvidence.count({
        where: {
          topicId: first.result.topicId,
        },
      }),
    ).toBe(1);
  });

  it("returns a not-found error for an unknown site", async () => {
    const deletedSite = await createSite("unknown-site");
    await requireDatabase().site.delete({
      where: {
        id: deletedSite.id,
      },
    });

    await expect(
      intake(requestFor(deletedSite.id, `${runToken}-unknown-site`)),
    ).rejects.toMatchObject({
      code: "site_not_found",
    });
  });

  it("rejects a source configuration owned by another site", async () => {
    const submittedSite = await createSite("source-mismatch-submitted");
    const ownerSite = await createSite("source-mismatch-owner");
    const sourceConfiguration = await requireDatabase().sourceConfig.create({
      data: {
        collectionMethod: "MANUAL",
        name: "Other site source",
        siteId: ownerSite.id,
        sourceType: "MANUAL",
      },
    });

    await expect(
      intake(
        requestFor(submittedSite.id, `${runToken}-source-mismatch`, {
          source: {
            evidenceType: "source",
            sourceConfigId: sourceConfiguration.id,
            sourceUrl: "https://example.com/mismatch",
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "source_configuration_not_found",
    });
  });

  it("rejects an inactive source configuration", async () => {
    const site = await createSite("inactive-source");
    const sourceConfiguration = await requireDatabase().sourceConfig.create({
      data: {
        collectionMethod: "MANUAL",
        isActive: false,
        name: "Inactive source",
        siteId: site.id,
        sourceType: "MANUAL",
      },
    });

    await expect(
      intake(
        requestFor(site.id, `${runToken}-inactive-source`, {
          source: {
            evidenceType: "source",
            sourceConfigId: sourceConfiguration.id,
            sourceUrl: "https://example.com/inactive",
          },
        }),
      ),
    ).rejects.toMatchObject({
      name: "InactiveSourceConfigurationError",
    });
  });

  it("handles concurrent equivalent requests without duplicate topics", async () => {
    const site = await createSite("concurrent");
    const requests = Array.from({ length: 4 }, (_, index) =>
      intake(
        requestFor(site.id, `${runToken}-concurrent-${index}`, {
          title:
            index % 2 === 0 ? "Concurrent topic?" : "  CONCURRENT   TOPIC ",
        }),
      ),
    );
    const responses = await Promise.all(requests);

    expect(
      responses.filter((response) => response.result.topicCreated),
    ).toHaveLength(1);
    expect(
      await requireDatabase().topic.count({
        where: {
          siteId: site.id,
        },
      }),
    ).toBe(1);
  });

  it("creates first-processing audit records only once on replay", async () => {
    const site = await createSite("audit-once");
    const request = requestFor(site.id, `${runToken}-audit-once`, {
      source: {
        evidenceType: "manual",
        sourceUrl: "https://example.com/audit",
      },
    });
    const first = await intake(request);
    await intake(request);

    expect(
      await requireDatabase().auditLog.count({
        where: {
          OR: [
            {
              entityId: first.result.topicId,
            },
            {
              entityId: first.result.evidenceId ?? "",
            },
          ],
        },
      }),
    ).toBe(2);
  });

  it("rolls back idempotency and topic records when validation fails in the transaction", async () => {
    const site = await createSite("rollback");
    const sourceConfiguration = await requireDatabase().sourceConfig.create({
      data: {
        collectionMethod: "MANUAL",
        isActive: false,
        name: "Rollback source",
        siteId: site.id,
        sourceType: "MANUAL",
      },
    });
    const request = requestFor(site.id, `${runToken}-rollback`, {
      source: {
        evidenceType: "source",
        sourceConfigId: sourceConfiguration.id,
        sourceUrl: "https://example.com/rollback",
      },
    });

    await expect(intake(request)).rejects.toMatchObject({
      name: "InactiveSourceConfigurationError",
    });
    expect(
      await requireDatabase().topic.count({
        where: {
          siteId: site.id,
        },
      }),
    ).toBe(0);
    expect(
      await requireDatabase().intakeIdempotencyRecord.count({
        where: {
          key: request.idempotencyKey,
        },
      }),
    ).toBe(0);
  });

  it("shares durable rate-limit state across limiter instances", async () => {
    const options = {
      database: requireDatabase(),
      limit: 2,
      scope: rateLimitScope,
      windowSeconds: 60,
    };
    const firstInstance = new PostgresInternalApiRateLimiter(options);
    const secondInstance = new PostgresInternalApiRateLimiter(options);

    expect((await firstInstance.check("integration-key")).allowed).toBe(true);
    expect((await secondInstance.check("integration-key")).allowed).toBe(true);
    expect((await firstInstance.check("integration-key")).allowed).toBe(false);
  });
});
