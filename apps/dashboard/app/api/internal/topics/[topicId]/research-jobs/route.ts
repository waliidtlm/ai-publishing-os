import { getDatabaseClient } from "@ai-publishing-os/database";
import { researchCreateJobRequestSchema } from "@ai-publishing-os/schemas";
import { z } from "zod";

import {
  getDatabaseEnvironment,
  getInternalApiEnvironment,
  getResearchEnvironment,
} from "@/lib/env/server";
import { authenticateInternalRequest } from "@/lib/internal-api/authenticate";
import {
  correlationIdFor,
  internalErrorResponse,
  internalJsonResponse,
} from "@/lib/internal-api/response";
import { checkInternalRouteRateLimit } from "@/lib/internal-api/route-rate-limit";
import { getApplicationLogger } from "@/lib/logging/logger";
import { ResearchError } from "@/lib/research/errors";
import { createResearchJob } from "@/lib/research/service";

export const dynamic = "force-dynamic";

const topicIdSchema = z.string().cuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ topicId: string }> },
) {
  const startedAt = performance.now();
  const correlationId = correlationIdFor(request);
  const logger = getApplicationLogger().child({
    correlationId,
    route: "POST /api/internal/topics/:topicId/research-jobs",
  });

  try {
    if (!authenticateInternalRequest(request)) {
      logger.warn(
        { outcome: "authentication_failed" },
        "Research job creation rejected",
      );
      return internalErrorResponse(
        401,
        "unauthorized",
        "Valid internal authentication is required.",
        correlationId,
      );
    }

    const { topicId: rawTopicId } = await context.params;
    const topicId = topicIdSchema.safeParse(rawTopicId);

    if (!topicId.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The topic ID is invalid.",
        correlationId,
      );
    }

    const requestText = await request.text();
    let body: unknown = {};

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

    const parsed = researchCreateJobRequestSchema.safeParse(body);

    if (!parsed.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The research-job request failed validation.",
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
      "research-job-create",
    );

    if (!rateLimit.allowed) {
      return internalErrorResponse(
        429,
        "rate_limited",
        "The research-job creation rate limit was exceeded.",
        correlationId,
        { additionalHeaders: rateLimit.headers, retryable: true },
      );
    }

    const result = await createResearchJob({
      correlationId,
      database,
      environment: getResearchEnvironment(),
      request: parsed.data,
      topicId: topicId.data,
    });

    logger.info(
      {
        durationMs: Math.round(performance.now() - startedAt),
        mode: result.job.mode.toLowerCase(),
        outcome: "created",
        researchJobId: result.job.id,
        siteId: result.job.siteId,
        sourceCount: result.sources.length,
        topicId: result.job.topicId,
      },
      "Research job created",
    );

    return internalJsonResponse(
      { data: result, success: true },
      201,
      correlationId,
      rateLimit.headers,
    );
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);

    if (error instanceof ResearchError) {
      logger.info(
        { durationMs, outcome: error.code, retryable: error.retryable },
        "Research job creation failed safely",
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
      "Research job creation failed",
    );
    return internalErrorResponse(
      500,
      "internal_error",
      "The research job could not be created.",
      correlationId,
    );
  }
}
