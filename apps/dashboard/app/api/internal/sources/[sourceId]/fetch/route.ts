import { getDatabaseClient } from "@ai-publishing-os/database";
import { rssFetchRequestSchema } from "@ai-publishing-os/schemas";
import { z } from "zod";

import {
  getDatabaseEnvironment,
  getInternalApiEnvironment,
  getRssCollectorEnvironment,
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
import { fetchRssSource } from "@/lib/rss/service";

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
    route: "POST /api/internal/sources/:sourceId/fetch",
  });

  try {
    if (!authenticateInternalRequest(request)) {
      logger.warn({ outcome: "authentication_failed" }, "RSS fetch rejected");
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

    let body: unknown = {};
    const requestText = await request.text();

    if (requestText.trim()) {
      try {
        body = JSON.parse(requestText);
      } catch {
        return internalErrorResponse(
          400,
          "malformed_json",
          "The request body must be valid JSON.",
          correlationId,
        );
      }
    }

    const parsed = rssFetchRequestSchema.safeParse(body);

    if (!parsed.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The request body failed validation.",
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
      "rss-feed-fetch",
    );

    if (!rateLimit.allowed) {
      return internalErrorResponse(
        429,
        "rate_limited",
        "The internal RSS fetch rate limit was exceeded.",
        correlationId,
        { additionalHeaders: rateLimit.headers, retryable: true },
      );
    }

    const result = await fetchRssSource({
      database,
      entryLimit: parsed.data.entryLimit,
      environment: getRssCollectorEnvironment(),
      sourceId: parsedSourceId.data,
    });

    logger.info(
      {
        discoveredCount: result.discoveredCount,
        durationMs: Math.round(performance.now() - startedAt),
        outcome: result.status,
        returnedCount: result.returnedCount,
        sourceId: result.sourceId,
      },
      "RSS feed fetched",
    );

    return internalJsonResponse(
      { data: result, success: true },
      200,
      correlationId,
      rateLimit.headers,
    );
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);

    if (error instanceof RssCollectorError) {
      logger.warn(
        {
          durationMs,
          outcome: error.code,
          retryable: error.retryable,
        },
        "RSS feed fetch failed safely",
      );
      return internalErrorResponse(
        error.httpStatus,
        error.code,
        error.message,
        correlationId,
        { retryable: error.retryable },
      );
    }

    logger.error(
      { durationMs, err: error, outcome: "unexpected_error" },
      "RSS feed fetch failed",
    );
    return internalErrorResponse(
      500,
      "internal_error",
      "The RSS feed could not be fetched.",
      correlationId,
    );
  }
}
