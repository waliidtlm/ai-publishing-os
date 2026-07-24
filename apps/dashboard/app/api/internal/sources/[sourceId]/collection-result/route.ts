import { getDatabaseClient } from "@ai-publishing-os/database";
import { rssCollectionResultSchema } from "@ai-publishing-os/schemas";
import { z } from "zod";

import {
  getDatabaseEnvironment,
  getInternalApiEnvironment,
} from "@/lib/env/server";
import { authenticateInternalRequest } from "@/lib/internal-api/authenticate";
import {
  correlationIdFor,
  internalErrorResponse,
  internalJsonResponse,
} from "@/lib/internal-api/response";
import { checkInternalRouteRateLimit } from "@/lib/internal-api/route-rate-limit";
import { getApplicationLogger } from "@/lib/logging/logger";
import { RssCollectorError } from "@/lib/rss/errors";
import { recordRssCollectionResult } from "@/lib/rss/service";

export const dynamic = "force-dynamic";

const sourceIdSchema = z.string().cuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ sourceId: string }> },
) {
  const startedAt = performance.now();
  const correlationId = correlationIdFor(request);
  const logger = getApplicationLogger().child({
    correlationId,
    route: "POST /api/internal/sources/:sourceId/collection-result",
  });

  try {
    if (!authenticateInternalRequest(request)) {
      logger.warn(
        { outcome: "authentication_failed" },
        "RSS collection result rejected",
      );
      return internalErrorResponse(
        401,
        "unauthorized",
        "Valid internal authentication is required.",
        correlationId,
      );
    }

    const { sourceId: rawSourceId } = await context.params;
    const parsedSourceId = sourceIdSchema.safeParse(rawSourceId);

    if (!parsedSourceId.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The source ID is invalid.",
        correlationId,
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return internalErrorResponse(
        400,
        "malformed_json",
        "The request body must be valid JSON.",
        correlationId,
      );
    }

    const parsed = rssCollectionResultSchema.safeParse(body);

    if (!parsed.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The collection result failed validation.",
        correlationId,
        {
          fields: parsed.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path.join(".") || "$",
          })),
        },
      );
    }

    const database = getDatabaseClient(getDatabaseEnvironment().DATABASE_URL);
    const rateLimit = await checkInternalRouteRateLimit(
      database,
      getInternalApiEnvironment(),
      "rss-collection-result",
    );

    if (!rateLimit.allowed) {
      return internalErrorResponse(
        429,
        "rate_limited",
        "The internal RSS result rate limit was exceeded.",
        correlationId,
        { additionalHeaders: rateLimit.headers, retryable: true },
      );
    }

    const result = await recordRssCollectionResult({
      correlationId,
      database,
      request: parsed.data,
      sourceId: parsedSourceId.data,
    });

    logger.info(
      {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: result.status,
        runId: result.runId,
        sourceId: result.sourceId,
      },
      "RSS collection result recorded",
    );

    return internalJsonResponse(
      { data: result, success: true },
      parsed.data.status === "started" ? 201 : 200,
      correlationId,
      rateLimit.headers,
    );
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);

    if (error instanceof RssCollectorError) {
      logger.info(
        { durationMs, outcome: error.code },
        "RSS collection result reference rejected",
      );
      return internalErrorResponse(
        error.httpStatus,
        error.code,
        error.message,
        correlationId,
      );
    }

    logger.error(
      { durationMs, err: error, outcome: "unexpected_error" },
      "RSS collection result failed",
    );
    return internalErrorResponse(
      500,
      "internal_error",
      "The RSS collection result could not be recorded.",
      correlationId,
    );
  }
}
