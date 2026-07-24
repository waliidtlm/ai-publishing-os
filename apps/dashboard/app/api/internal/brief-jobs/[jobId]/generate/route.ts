import { getDatabaseClient } from "@ai-publishing-os/database";
import { contentBriefGenerateRequestSchema } from "@ai-publishing-os/schemas";
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
import { generateContentBrief } from "@/lib/content-brief/service";

export const dynamic = "force-dynamic";
const jobIdSchema = z.string().cuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const correlationId = correlationIdFor(request);
  const startedAt = performance.now();
  const logger = getApplicationLogger().child({
    correlationId,
    route: "POST /api/internal/brief-jobs/:jobId/generate",
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
    const jobId = jobIdSchema.safeParse((await context.params).jobId);
    if (!jobId.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The brief job ID is invalid.",
        correlationId,
      );
    }
    const text = await request.text();
    let body: unknown = {};
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
    if (!contentBriefGenerateRequestSchema.safeParse(body).success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The generate request failed validation.",
        correlationId,
      );
    }
    const database = getDatabaseClient(getDatabaseEnvironment().DATABASE_URL);
    const rateLimit = await checkInternalRouteRateLimit(
      database,
      getInternalApiEnvironment(),
      "brief-job-generate",
    );
    if (!rateLimit.allowed) {
      return internalErrorResponse(
        429,
        "rate_limited",
        "The brief generation rate limit was exceeded.",
        correlationId,
        { additionalHeaders: rateLimit.headers, retryable: true },
      );
    }
    const result = await generateContentBrief({
      correlationId,
      database,
      environment: getContentBriefEnvironment(),
      jobId: jobId.data,
    });
    logger.info(
      {
        briefId: result.brief.id,
        briefJobId: result.job.id,
        durationMs: Math.round(performance.now() - startedAt),
        idempotentReplay: result.idempotentReplay,
        sectionCount: result.job.generatedSectionCount,
        topicId: result.job.topicId,
        version: result.brief.version,
      },
      "Content brief generated",
    );
    return internalJsonResponse(
      { data: result, success: true },
      200,
      correlationId,
      rateLimit.headers,
    );
  } catch (error) {
    if (error instanceof ContentBriefError) {
      logger.info(
        { outcome: error.code },
        "Content brief generation failed safely",
      );
      return internalErrorResponse(
        error.httpStatus,
        error.code,
        error.message,
        correlationId,
        { retryable: error.retryable },
      );
    }
    logger.error({ err: error }, "Content brief generation failed");
    return internalErrorResponse(
      500,
      "internal_error",
      "The content brief could not be generated.",
      correlationId,
    );
  }
}
