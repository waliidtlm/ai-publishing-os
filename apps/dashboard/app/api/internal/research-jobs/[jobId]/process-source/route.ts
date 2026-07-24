import { getDatabaseClient } from "@ai-publishing-os/database";
import { researchProcessSourceRequestSchema } from "@ai-publishing-os/schemas";
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
import { processResearchSource } from "@/lib/research/service";

export const dynamic = "force-dynamic";

const jobIdSchema = z.string().cuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const startedAt = performance.now();
  const correlationId = correlationIdFor(request);
  const logger = getApplicationLogger().child({
    correlationId,
    route: "POST /api/internal/research-jobs/:jobId/process-source",
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

    const { jobId: rawJobId } = await context.params;
    const jobId = jobIdSchema.safeParse(rawJobId);

    if (!jobId.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The research job ID is invalid.",
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

    const parsed = researchProcessSourceRequestSchema.safeParse(body);

    if (!parsed.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The process-source request failed validation.",
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
      "research-source-process",
    );

    if (!rateLimit.allowed) {
      return internalErrorResponse(
        429,
        "rate_limited",
        "The research source-processing rate limit was exceeded.",
        correlationId,
        { additionalHeaders: rateLimit.headers, retryable: true },
      );
    }

    const result = await processResearchSource({
      correlationId,
      database,
      environment: getResearchEnvironment(),
      researchJobId: jobId.data,
      sourceId: parsed.data.sourceId,
    });

    logger.info(
      {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: result.status,
        researchJobId: jobId.data,
        sourceId: parsed.data.sourceId,
      },
      "Research source processing finished",
    );

    return internalJsonResponse(
      { data: result, success: true },
      200,
      correlationId,
      rateLimit.headers,
    );
  } catch (error) {
    if (error instanceof ResearchError) {
      return internalErrorResponse(
        error.httpStatus,
        error.code,
        error.message,
        correlationId,
        { retryable: error.retryable },
      );
    }

    logger.error({ err: error }, "Research source processing failed");
    return internalErrorResponse(
      500,
      "internal_error",
      "The research source could not be processed.",
      correlationId,
    );
  }
}
