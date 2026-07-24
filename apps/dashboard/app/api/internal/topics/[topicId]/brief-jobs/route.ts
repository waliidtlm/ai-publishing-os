import { getDatabaseClient } from "@ai-publishing-os/database";
import { contentBriefCreateJobRequestSchema } from "@ai-publishing-os/schemas";
import { z } from "zod";

import {
  getContentBriefEnvironment,
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
import { ContentBriefError } from "@/lib/content-brief/errors";
import { createBriefGenerationJob } from "@/lib/content-brief/service";

export const dynamic = "force-dynamic";
const topicIdSchema = z.string().cuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ topicId: string }> },
) {
  const correlationId = correlationIdFor(request);
  const startedAt = performance.now();
  const logger = getApplicationLogger().child({
    correlationId,
    route: "POST /api/internal/topics/:topicId/brief-jobs",
  });
  try {
    if (!authenticateInternalRequest(request)) {
      return internalErrorResponse(
        401,
        "unauthorized",
        "Valid internal authentication is required.",
        correlationId,
      );
    }
    const topicId = topicIdSchema.safeParse((await context.params).topicId);
    if (!topicId.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The topic ID is invalid.",
        correlationId,
      );
    }
    let body: unknown = {};
    const text = await request.text();
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return internalErrorResponse(
          400,
          "malformed_json",
          "The request body must be valid JSON.",
          correlationId,
        );
      }
    }
    const parsed = contentBriefCreateJobRequestSchema.safeParse(body);
    if (!parsed.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The brief-job request failed validation.",
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
      "brief-job-create",
    );
    if (!rateLimit.allowed) {
      return internalErrorResponse(
        429,
        "rate_limited",
        "The brief-job creation rate limit was exceeded.",
        correlationId,
        { additionalHeaders: rateLimit.headers, retryable: true },
      );
    }
    const result = await createBriefGenerationJob({
      correlationId,
      database,
      environment: getContentBriefEnvironment(),
      request: parsed.data,
      topicId: topicId.data,
    });
    logger.info(
      {
        briefJobId: result.job.id,
        durationMs: Math.round(performance.now() - startedAt),
        idempotentReplay: result.idempotentReplay,
        mode: result.job.mode.toLowerCase(),
        siteId: result.job.siteId,
        topicId: result.job.topicId,
      },
      "Content brief job resolved",
    );
    return internalJsonResponse(
      { data: result, success: true },
      result.idempotentReplay ? 200 : 201,
      correlationId,
      rateLimit.headers,
    );
  } catch (error) {
    if (error instanceof ContentBriefError) {
      logger.info(
        {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: error.code,
        },
        "Content brief job creation failed safely",
      );
      return internalErrorResponse(
        error.httpStatus,
        error.code,
        error.message,
        correlationId,
        { retryable: error.retryable },
      );
    }
    logger.error({ err: error }, "Content brief job creation failed");
    return internalErrorResponse(
      500,
      "internal_error",
      "The content brief job could not be created.",
      correlationId,
    );
  }
}
