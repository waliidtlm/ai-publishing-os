import { getDatabaseClient } from "@ai-publishing-os/database";
import { rssSourceListQuerySchema } from "@ai-publishing-os/schemas";

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
import { listActiveRssSources } from "@/lib/rss/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = performance.now();
  const correlationId = correlationIdFor(request);
  const logger = getApplicationLogger().child({
    correlationId,
    route: "GET /api/internal/sources/rss",
  });

  try {
    if (!authenticateInternalRequest(request)) {
      logger.warn(
        { outcome: "authentication_failed" },
        "RSS source list rejected",
      );
      return internalErrorResponse(
        401,
        "unauthorized",
        "Valid internal authentication is required.",
        correlationId,
      );
    }

    const database = getDatabaseClient(getDatabaseEnvironment().DATABASE_URL);
    const internalEnvironment = getInternalApiEnvironment();
    const rateLimit = await checkInternalRouteRateLimit(
      database,
      internalEnvironment,
      "rss-source-list",
    );

    if (!rateLimit.allowed) {
      return internalErrorResponse(
        429,
        "rate_limited",
        "The internal RSS source-list rate limit was exceeded.",
        correlationId,
        { additionalHeaders: rateLimit.headers, retryable: true },
      );
    }

    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const parsed = rssSourceListQuerySchema.safeParse(query);

    if (!parsed.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The request query failed validation.",
        correlationId,
        {
          additionalHeaders: rateLimit.headers,
          fields: parsed.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path.join(".") || "$",
          })),
        },
      );
    }

    const environment = getRssCollectorEnvironment();
    const limit = Math.min(
      parsed.data.limit ?? environment.RSS_MAX_SOURCES_PER_RUN,
      environment.RSS_MAX_SOURCES_PER_RUN,
    );
    const sources = await listActiveRssSources(database, limit);

    logger.info(
      {
        count: sources.length,
        durationMs: Math.round(performance.now() - startedAt),
        outcome: "succeeded",
      },
      "Active RSS sources listed",
    );

    return internalJsonResponse(
      {
        data: {
          count: sources.length,
          sources,
        },
        success: true,
      },
      200,
      correlationId,
      rateLimit.headers,
    );
  } catch (error) {
    logger.error(
      {
        durationMs: Math.round(performance.now() - startedAt),
        err: error,
        outcome: "unexpected_error",
      },
      "RSS source listing failed",
    );
    return internalErrorResponse(
      500,
      "internal_error",
      "RSS sources could not be listed.",
      correlationId,
    );
  }
}
