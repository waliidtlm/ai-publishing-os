import {
  Prisma,
  RssCollectionStatus,
  type PrismaClient,
} from "@ai-publishing-os/database";
import type {
  RssCollectionCompletedRequest,
  RssCollectionResultRequest,
  RssCollectorEnvironment,
} from "@ai-publishing-os/schemas";

import { RssCollectorError } from "./errors";
import { fetchConfiguredFeed } from "./fetch-feed";
import { sanitizeErrorSummary } from "./sanitize";

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function requireRssSource(database: PrismaClient, sourceId: string) {
  const source = await database.sourceConfig.findUnique({
    select: {
      baseUrl: true,
      collectionLimit: true,
      collectionMethod: true,
      httpEtag: true,
      httpLastModified: true,
      id: true,
      isActive: true,
      name: true,
      siteId: true,
      sourceType: true,
    },
    where: {
      id: sourceId,
    },
  });

  if (!source) {
    throw new RssCollectorError(
      "rss_source_not_found",
      "The RSS source configuration was not found.",
      404,
    );
  }

  if (source.sourceType !== "RSS" || source.collectionMethod !== "RSS") {
    throw new RssCollectorError(
      "source_not_rss",
      "The source configuration is not an RSS source.",
      422,
    );
  }

  if (!source.isActive) {
    throw new RssCollectorError(
      "inactive_rss_source",
      "The RSS source configuration is inactive.",
      422,
    );
  }

  return source;
}

export async function listActiveRssSources(
  database: PrismaClient,
  limit: number,
) {
  const sources = await database.sourceConfig.findMany({
    orderBy: [{ lastCollectedAt: "asc" }, { createdAt: "asc" }],
    select: {
      baseUrl: true,
      collectionLimit: true,
      httpEtag: true,
      httpLastModified: true,
      id: true,
      lastCollectedAt: true,
      lastErrorAt: true,
      lastErrorSummary: true,
      lastSuccessfulCollectedAt: true,
      name: true,
      site: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    take: limit,
    where: {
      collectionMethod: "RSS",
      isActive: true,
      sourceType: "RSS",
    },
  });

  return sources.map((source) => ({
    collectionLimit: source.collectionLimit,
    etag: source.httpEtag,
    feedUrl: source.baseUrl,
    id: source.id,
    lastCollectedAt: source.lastCollectedAt?.toISOString() ?? null,
    lastErrorAt: source.lastErrorAt?.toISOString() ?? null,
    lastErrorSummary: source.lastErrorSummary,
    lastModified: source.httpLastModified,
    lastSuccessfulCollectedAt:
      source.lastSuccessfulCollectedAt?.toISOString() ?? null,
    name: source.name,
    siteId: source.site.id,
    siteName: source.site.name,
  }));
}

export async function fetchRssSource(options: {
  database: PrismaClient;
  entryLimit?: number;
  environment: RssCollectorEnvironment;
  sourceId: string;
}) {
  const source = await requireRssSource(options.database, options.sourceId);

  if (!source.baseUrl) {
    throw new RssCollectorError(
      "invalid_feed_url",
      "The RSS source does not have a configured feed URL.",
      422,
    );
  }

  const entryLimit = Math.min(
    options.entryLimit ?? Number.POSITIVE_INFINITY,
    source.collectionLimit ?? Number.POSITIVE_INFINITY,
    options.environment.RSS_MAX_ENTRIES_PER_SOURCE,
  );
  const result = await fetchConfiguredFeed({
    etag: source.httpEtag,
    feedUrl: source.baseUrl,
    lastModified: source.httpLastModified,
    limits: {
      entryLimit,
      maxRedirects: options.environment.RSS_MAX_REDIRECTS,
      maxResponseBytes: options.environment.RSS_MAX_RESPONSE_BYTES,
      timeoutMs: options.environment.RSS_REQUEST_TIMEOUT_MS,
    },
  });

  return {
    ...result,
    sourceId: source.id,
  };
}

const collectionStatusMap: Record<
  RssCollectionCompletedRequest["status"],
  RssCollectionStatus
> = {
  failed: RssCollectionStatus.FAILED,
  not_modified: RssCollectionStatus.NOT_MODIFIED,
  partial: RssCollectionStatus.PARTIAL,
  succeeded: RssCollectionStatus.SUCCEEDED,
};

function auditAction(status: RssCollectionCompletedRequest["status"]) {
  const suffix = {
    failed: "failed",
    not_modified: "not_modified",
    partial: "partial",
    succeeded: "succeeded",
  }[status];

  return `rss.source.collection_${suffix}`;
}

export async function recordRssCollectionResult(options: {
  correlationId: string;
  database: PrismaClient;
  request: RssCollectionResultRequest;
  sourceId: string;
}) {
  const source = await requireRssSource(options.database, options.sourceId);
  const request = options.request;

  if (request.status === "started") {
    const startedAt = request.startedAt
      ? new Date(request.startedAt)
      : new Date();

    return options.database.$transaction(async (transaction) => {
      const run = await transaction.rssCollectionRun.create({
        data: {
          sourceConfigId: source.id,
          startedAt,
          status: RssCollectionStatus.STARTED,
          workflowExecutionId: request.workflowExecutionId,
        },
      });

      await transaction.sourceConfig.update({
        data: {
          lastCollectedAt: startedAt,
        },
        where: {
          id: source.id,
        },
      });

      await transaction.auditLog.create({
        data: {
          action: "rss.source.collection_started",
          entityId: source.id,
          entityType: "source_config",
          newValue: asInputJson({
            correlationId: options.correlationId,
            runId: run.id,
            siteId: source.siteId,
          }),
        },
      });

      return {
        runId: run.id,
        sourceId: source.id,
        status: "started" as const,
      };
    });
  }

  const completedAt = request.completedAt
    ? new Date(request.completedAt)
    : new Date();
  const errorSummary = sanitizeErrorSummary(request.errorSummary);
  const status = collectionStatusMap[request.status];
  const successful =
    request.status === "succeeded" || request.status === "not_modified";

  return options.database.$transaction(async (transaction) => {
    const run = await transaction.rssCollectionRun.findFirst({
      select: {
        id: true,
        startedAt: true,
      },
      where: {
        id: request.runId,
        sourceConfigId: source.id,
      },
    });

    if (!run) {
      throw new RssCollectorError(
        "rss_source_not_found",
        "The RSS collection run was not found for this source.",
        404,
      );
    }

    await transaction.rssCollectionRun.update({
      data: {
        acceptedCount: request.acceptedCount,
        completedAt,
        discoveredCount: request.discoveredCount,
        durationMs: request.durationMs,
        errorCode: request.errorCode,
        errorSummary,
        etag: request.etag,
        failedCount: request.failedCount,
        httpStatus: request.httpStatus,
        lastModified: request.lastModified,
        matchedCount: request.matchedCount,
        returnedCount: request.returnedCount,
        skippedCount: request.skippedCount,
        status,
        submittedCount: request.submittedCount,
      },
      where: {
        id: run.id,
      },
    });

    await transaction.sourceConfig.update({
      data: {
        ...(request.etag !== undefined ? { httpEtag: request.etag } : {}),
        ...(request.lastModified !== undefined
          ? { httpLastModified: request.lastModified }
          : {}),
        ...(successful
          ? {
              lastErrorAt: null,
              lastErrorSummary: null,
              lastSuccessfulCollectedAt: completedAt,
            }
          : {
              lastErrorAt: completedAt,
              lastErrorSummary:
                errorSummary ??
                (request.status === "partial"
                  ? "One or more feed entries could not be submitted."
                  : "The RSS collection failed."),
            }),
      },
      where: {
        id: source.id,
      },
    });

    await transaction.auditLog.create({
      data: {
        action: auditAction(request.status),
        entityId: source.id,
        entityType: "source_config",
        newValue: asInputJson({
          acceptedCount: request.acceptedCount,
          correlationId: options.correlationId,
          discoveredCount: request.discoveredCount,
          errorCode: request.errorCode ?? null,
          failedCount: request.failedCount,
          matchedCount: request.matchedCount,
          runId: run.id,
          siteId: source.siteId,
          submittedCount: request.submittedCount,
        }),
      },
    });

    return {
      completedAt: completedAt.toISOString(),
      runId: run.id,
      sourceId: source.id,
      status: request.status,
    };
  });
}
